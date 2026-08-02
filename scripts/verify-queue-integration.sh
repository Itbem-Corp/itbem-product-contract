#!/usr/bin/env bash
set -euo pipefail

fixture="contract/runtime-messages.v1.json"
test -f "$fixture"
name="eventiapp-contract-${GITHUB_RUN_ID:-local}-$$"
container="${name}-localstack"

cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker run -d --name "$container" \
  -e SERVICES=sqs \
  -e AWS_DEFAULT_REGION=us-east-2 \
  -p 127.0.0.1::4566 \
  localstack/localstack:3.8 >/dev/null

for _ in $(seq 1 30); do
  if docker exec "$container" awslocal sqs list-queues >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" awslocal sqs list-queues >/dev/null

dlq="$name-dlq"
queue="$name-jobs"
docker exec "$container" awslocal sqs create-queue --queue-name "$dlq" >/dev/null
dlq_url="$(docker exec "$container" awslocal sqs get-queue-url --queue-name "$dlq" --query QueueUrl --output text)"
dlq_arn="$(docker exec "$container" awslocal sqs get-queue-attributes --queue-url "$dlq_url" --attribute-names QueueArn --query Attributes.QueueArn --output text)"
attributes="$(node -e 'console.log(JSON.stringify({RedrivePolicy: JSON.stringify({deadLetterTargetArn: process.argv[1], maxReceiveCount: "1"}), VisibilityTimeout: "0"}))' "$dlq_arn")"
encoded_attributes="$(printf '%s' "$attributes" | base64 -w 0)"
docker exec "$container" sh -c "printf '%s' '$encoded_attributes' | base64 -d >/tmp/attributes.json; awslocal sqs create-queue --queue-name '$queue' --attributes file:///tmp/attributes.json" >/dev/null
queue_url="$(docker exec "$container" awslocal sqs get-queue-url --queue-name "$queue" --query QueueUrl --output text)"

body="$(node -e 'const f=require("./contract/runtime-messages.v1.json"); process.stdout.write(JSON.stringify(f.workerJobs[0].envelope))')"
encoded_body="$(printf '%s' "$body" | base64 -w 0)"
docker exec "$container" sh -c "printf '%s' '$encoded_body' | base64 -d >/tmp/message.json; awslocal sqs send-message --queue-url '$queue_url' --message-body file:///tmp/message.json" >/dev/null

received="$(docker exec "$container" awslocal sqs receive-message --queue-url "$queue_url" --attribute-names All --wait-time-seconds 1 --output json)"
node -e 'const m=JSON.parse(process.argv[1]).Messages; if (!m?.[0]) process.exit(1); const j=JSON.parse(m[0].Body); if (j.schema_version !== 2 || j.type !== "analytics.rollup" || !j.job_id) process.exit(1)' "$received"
sleep 1
docker exec "$container" awslocal sqs receive-message --queue-url "$queue_url" --wait-time-seconds 1 >/dev/null
dead="$(docker exec "$container" awslocal sqs receive-message --queue-url "$dlq_url" --wait-time-seconds 2 --output json)"
node -e 'const m=JSON.parse(process.argv[1]).Messages; if (!m?.[0] || JSON.parse(m[0].Body).schema_version !== 2) process.exit(1)' "$dead"

echo 'SQS contract integration passed.'

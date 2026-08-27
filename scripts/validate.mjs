import { loadContract } from './contract.mjs'
import { validateProductContract, validateRequestContext, validateRuntimeMessages } from './invariants.mjs'
import fs from 'node:fs'

validateProductContract(loadContract())

const requestContext = JSON.parse(fs.readFileSync(new URL('../contract/request-context.v1.json', import.meta.url), 'utf8'))
validateRequestContext(requestContext)

const runtimeMessages = JSON.parse(fs.readFileSync(new URL('../contract/runtime-messages.v1.json', import.meta.url), 'utf8'))
validateRuntimeMessages(runtimeMessages)

const localAiJobs = JSON.parse(fs.readFileSync(new URL('../contract/ai-local-jobs.v1.json', import.meta.url), 'utf8'))
if (localAiJobs.schemaVersion !== 1 || localAiJobs.product !== 'itbem') throw new Error('Local AI jobs must be a versioned ITBEM-only contract')
const localAiJob = localAiJobs.localAgent?.jobFixture
if (!localAiJob || localAiJob.tenant_code !== 'itbem' || localAiJob.type !== 'ai.local.process' || !localAiJob.job_id || !localAiJob.payload?.task_id || !localAiJob.payload?.operation || !localAiJob.payload?.input_ref) {
  throw new Error('Local AI job fixture is invalid')
}
const localAiCallback = localAiJobs.localAgent?.callbackFixture
if (!localAiCallback || localAiCallback.tenant_code !== 'itbem' || localAiCallback.status !== 'completed' || !localAiCallback.task_id || localAiCallback.provider !== 'minimax' || localAiCallback.model !== 'MiniMax-M3' || !localAiCallback.usage?.total_tokens) {
  throw new Error('Local AI callback fixture is invalid')
}

const asyncDelegation = JSON.parse(fs.readFileSync(new URL('../contract/async-delegation.v1.json', import.meta.url), 'utf8'))
if (asyncDelegation.schemaVersion !== 1) throw new Error('Async delegation contract must use schemaVersion 1')
const runtimeOwners = new Set(asyncDelegation.runtimeOwners ?? [])
for (const owner of ['api', 'rust-worker', 'lambda', 'local-ai-agent']) {
  if (!runtimeOwners.has(owner)) throw new Error(`Async delegation contract is missing runtime owner: ${owner}`)
}
for (const invariant of ['apiPersistsAuthoritativeIntent', 'handoffsUseTransactionalOutbox', 'directCrossRuntimeQueueWritesForbidden', 'payloadsAreReferencesNotInlineSecrets', 'everyHandoffHasIdempotencyKey', 'everyHandoffHasQueryableOutcome', 'consumersTreatDuplicateDeliveryAsNormal']) {
  if (asyncDelegation.invariants?.[invariant] !== true) throw new Error(`Async delegation invariant is required: ${invariant}`)
}
const profiles = asyncDelegation.executionProfiles ?? []
for (const owner of ['api', 'rust-worker', 'lambda', 'local-ai-agent']) {
  if (!profiles.some((candidate) => candidate?.runtime === owner && Array.isArray(candidate.best_for) && candidate.best_for.length > 0)) throw new Error(`Async delegation must define an execution profile for ${owner}`)
}
const handoff = asyncDelegation.handoffFixture
const outcome = asyncDelegation.outcomeFixture
if (!handoff?.handoff_id || !handoff.correlation_id || !handoff.causation_id || !handoff.idempotency_key || !handoff.payload_ref || !runtimeOwners.has(handoff.source?.runtime) || !runtimeOwners.has(handoff.target?.runtime) || handoff.source.runtime === handoff.target.runtime || !handoff.target?.capability || !handoff.target?.queue_namespace) {
  throw new Error('Async delegation handoff fixture is invalid')
}
if (!outcome?.handoff_id || outcome.handoff_id !== handoff.handoff_id || outcome.idempotency_key !== handoff.idempotency_key || !outcome.result_ref || !runtimeOwners.has(outcome.owner_runtime) || outcome.status !== 'completed') {
  throw new Error('Async delegation outcome fixture is invalid')
}

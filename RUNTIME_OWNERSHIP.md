# Runtime ownership boundaries

Each queue, durable execution and callback has one runtime owner. A consumer
must never be attached to another runtime's queue merely because it can parse
or retry a message.

| Runtime | Owns | Must not own |
| --- | --- | --- |
| Go API (`itbem-events-backend`) | HTTP/authentication, domain writes, outbox publication, internal callback validation and the ITBEM Delivery control plane | heavy media conversion, long-running analytics execution or local AI task execution |
| Rust workers (`itbem-events-workers`) | Durable EventiApp business/data jobs; today `analytics.rollup`, `performance.rollup`, `notification.slack`; queues in the `rust-worker-prod-*` namespace | `itbem-media-*` queues, `itbem-ai-*` queues, media transforms, release/deploy decisions |
| Go media Lambdas (`itbem-media-processor`) | SQS-triggered image/video transformations, scoped S3 reads/writes, and authenticated media callbacks | business rollups, Delivery automation, human gate transitions |
| TypeScript Cognito Lambda (`itbem-events-infrastructure/lambda/cognito-email-sender.ts`) | Cognito custom transactional email rendering and dispatch | SQS workloads, domain persistence, media or Delivery work |
| Local Go AI agent (`itbem-events-backend/cmd/itbem-ai-agent`) | ITBEM-only Delivery execution, private evidence and screenshots from `itbem-ai-local-*` | EventiApp worker queues, media queues, autonomous publication, merge or deployment |

## Queue ownership

| Queue namespace | Producer | Consumer | Contract |
| --- | --- | --- | --- |
| Worker queue configured as `SQS_WORKER_QUEUE_URL`, plus `rust-worker-prod-*` fan-in lanes | Go API outbox | Rust workers | `workerJobs` in `contract/runtime-messages.v1.json` |
| `itbem-media-images-*` and `itbem-media-videos-*` | Go API media repository | Go media Lambdas | `mediaProcessing.sqsFixtures` in `contract/runtime-messages.v1.json` |
| `itbem-ai-local-*` | ITBEM Delivery control plane | Local Go AI agent | Delivery task envelope and private S3 evidence |

The protection is deliberately layered: IAM is scoped to the owning queues,
the Rust worker rejects media/AI queue configuration at startup, discovery only
lists `rust-worker-prod-*`, and message schemas reject unknown job types.

## Delegating asynchronous work

The API is the **orchestrator**, not a permanent home for every computation.
After it validates a request and commits the authoritative state, it can hand
off any suitable workload through the transactional outbox. Rust and Lambda
ownership is deliberately extensible; the current job list is not a ceiling.
The table below is a runtime-selection guide, not a language boundary: work
currently implemented in Go may deliberately move to Rust or a Lambda when
its execution profile changes.

### The runtime is selected per execution profile, not per repository

"Implemented in the Go backend today" is not an ownership decision. A
capability can expose one synchronous API endpoint while its expensive,
unreliable or slow portions are handled by several asynchronous runtimes. For
example, the API may validate an import and return `202 Accepted`; a Rust job
can normalize and reconcile it; a Lambda can scan or preview each uploaded
file; and a final Rust projection can update the product-facing status. The
user sees one tracked operation, while each execution has a clear owner.

Keep only the **authoritative, short and interactive** part in the API. Move
work out when waiting for it would make a request slow, when it needs durable
retry/backoff, when it may burst, or when it benefits from a specialist
runtime. The move is reversible: it is a typed handoff with a stable result
contract, not a rewrite of the product boundary.

Moving a capability does **not** mean a Rust worker or Lambda invokes Go code
inside the API process. The API keeps the authorization and authoritative
state transition; the selected runtime gets its own handler for the bounded
asynchronous step. Register its typed message, dedicated queue/event source,
idempotency strategy, callback/projection and end-to-end test before the API
emits that handoff. That is how a current Go implementation can be split or
migrated safely without turning the API into a background worker.

| Choose | When the work looks like | Examples that may move out of Go |
| --- | --- | --- |
| Rust worker | sustained throughput, retryable database or API work, a bounded but non-trivial processor, reusable long-lived dependencies, or controlled concurrency | exports, reconciliation, digest generation, search/index projection, webhook delivery, batch invitations, reports, data imports |
| Lambda | an isolated event-triggered action, short/medium bounded execution, bursty demand, per-message resource isolation or native transform layer | image/video derivatives, document preview/OCR, file malware scan, webhooks that do not need a warm worker, Cognito messages |
| Go API | authorization, request validation, short reads/writes that must be atomic with the response, issuing presigned URLs and starting an async workflow | create the record, persist the outbox event, return accepted/processing state |
| Local Go AI agent | ITBEM-private work that needs an approved local workspace, model access, screenshots or human gates | Delivery plans, coding worktrees, evidence capture and QA preparation |

An async workflow can therefore have more than one owner over its lifetime:

```text
HTTP API (authorize + record intent) -> outbox -> Rust worker (durable job)
                                      -> Lambda (isolated file/event step)
                                      -> Rust worker (projection or follow-up)
                                      -> API status/read model
```

The API owns the domain decision and public status; it does not have to own
the CPU, I/O or retry loop that realizes that decision.

## Controlled repository synchronization

Repository synchronization is an explicit human operation, not an incidental
side effect of planning or implementation. A workspace may opt into
`repository:fetch`, which permits only `git fetch --prune --tags origin` with
interactive prompts disabled. Fetching updates remote references so the
control plane can observe whether a tracking branch is ahead; it does not
change `HEAD`, checkout files, merge, rebase, commit, push or alter a frozen
Delivery checkpoint.

`git pull` is intentionally not an agent capability. If fetched refs reveal a
new base, a person updates the local branch outside the Delivery execution,
creates a fresh context checkpoint, and obtains a new plan gate when the
change affects the task. Publishing remains separately controlled by a
short-lived grant for the reviewed worktree, branch and diff.

### Runtime-to-runtime handoffs

A worker may need another runtime to finish a workflow. That is allowed, but
it is still a durable handoff rather than a direct SDK call. The producer
commits the new job intent with the state transition that requires it; the
outbox dispatcher then sends it to the queue owned by the next runtime. If a
runtime cannot atomically write the authoritative record and its outbox event,
it requests that transition from the backend through an authenticated internal
command. It must not send directly to another runtime's SQS queue.

This keeps retries, correlation IDs, cost attribution, DLQ policy and audit
history intact when a Rust job needs a Lambda transform, or when a Lambda
completion causes a Rust projection to run. Each handoff has a new typed
envelope and idempotency key; a consumer never borrows another runtime's
queue or credentials.

The language-neutral envelope and outcome requirements are versioned in
`contract/async-delegation.v1.json`. It deliberately records a payload
reference rather than an inline payload, so credentials, uploaded documents
and other sensitive inputs never become queue metadata. The outcome links back
to the handoff ID and idempotency key, making the whole chain queryable from
the API even when several runtimes participated.

The API persists the approved runtime label and queue namespace label with
each outbox handoff. These are stable audit labels, not a queue URL or secret;
they make correlation, retry and target ownership visible in logs and durable
operations data without leaking infrastructure topology.

### Candidates to move out of synchronous API paths

These are deliberate candidates, subject to a contract, SLO and migration
test. They are not a mandate to move every function immediately.

| Candidate | Preferred runtime | Why |
| --- | --- | --- |
| Batch invitations, RSVP reminders, exports, reports, reconciliation, search/index projections, webhook delivery | Rust worker | Controlled concurrency, durable retries and reusable connections make these throughput-oriented jobs. |
| OCR, document previews, malware scanning, image/video derivates and small isolated enrichments | Lambda | They are bursty, input-scoped and benefit from per-message isolation or native layers. |
| ITBEM coding, browser QA, screenshots, model calls and approved worktree actions | Local Go AI agent | They require the local environment, private evidence, model credentials and human gates. |
| Authentication, permissions, gate decisions, short transactional writes and status reads | Go API | These need an immediate, authoritative and auditable response. |

Every delegated workload preserves its product boundary. A move from Go does
not mean “fire and forget”: the API persists the intent in the outbox, the
consumer is idempotent, its status/evidence has a queryable home, and its
callback or projection is authenticated.

## Delegation standard and migration state

For a new capability, the API commits its domain mutation and a durable
`outbox_event` in the same database transaction, then returns an accepted job
reference. The dispatcher is the only component that hands that event to the
owning queue or runtime. Consumers must treat duplicate deliveries as normal
and update an observable job/result record through an authenticated callback
or projection.

| Workload | Current handoff | Owner | Direction |
| --- | --- | --- | --- |
| Analytics and Slack notifications | Transactional outbox → Rust worker queue | Rust | Established standard |
| ITBEM Delivery agent | Transactional outbox → local agent queue | Local Go agent | Established standard |
| Moment media processing | Transactional outbox → dedicated media Lambda queue | Go Lambda | Established durable handoff; image/video routing, IAM and callback contract remain isolated |
| Event-cover processing | Transactional outbox → dedicated media Lambda queue | Go Lambda | Established durable handoff; existing image queue, IAM and callback contract are unchanged |

The media migration was deliberately a compatibility change, not a reason to
merge image/video queues into the generic worker queue. A failed dispatch is
now retained by the outbox for retry, and no caller may silently mark an asset
as complete.

## Change rule

Adding a new asynchronous capability is how Go intentionally delegates work.
It requires one owning runtime, one queue namespace, an explicit contract
fixture, idempotency key, retry/DLQ policy, observable outcome and an
end-to-end test. For a Rust job, add the typed envelope and handler before the
API emits it; for a Lambda job, add a dedicated event source and scoped IAM.
Do not reuse an existing queue for a different runtime or workload class.

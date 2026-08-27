# ITBEM Product Contract

This is the versioned, language-neutral source of truth for product identity,
capabilities, public entry points, Cognito environment keys and worker topics.
The request-context contract also owns the dashboard-to-API header names and
workspace invariants shared by frontend and backend projections.
`contract/runtime-messages.v1.json` contains canonical, credential-free
fixtures for API-to-SQS messages and Lambda callbacks; the workspace uses them
to exercise the API, worker, and media message parsers together.
`contract/async-delegation.v1.json` establishes the durable cross-runtime
handoff envelope and outcome invariants. It lets a product capability move
from synchronous API work to Rust, Lambdas or the local AI runtime without
losing idempotency, correlation, private payload handling or observable state.
It contains no credentials, account IDs, database configuration or runtime
secrets.

[`RUNTIME_OWNERSHIP.md`](RUNTIME_OWNERSHIP.md) defines the non-overlapping
responsibility, queue and callback boundaries for the Go API, Rust workers,
Go media Lambdas, Cognito Lambda and local ITBEM AI agent.

Each deployable repository pins a contract revision and validates its local
projection during CI. Runtime services keep generated/static definitions: no
request makes a network call to load this contract, so adding governance does
not alter API or dashboard latency.

## Verification ownership

`Validate product contract` is the contract repository's independent CI gate:
it validates the schema and cross-product invariants on every pull request and
main-branch change. Consumers retain their own projection tests because each
runtime owns its implementation details. From the coordinated workspace,
`./eventiapp.ps1 check -Target core -Fast` validates the contract and confirms
that every declared consumer submodule pins the same revision. It never updates
consumer pins automatically; a contract change must be promoted deliberately
with its corresponding projections.

## Change process

1. Add or update one entry in `contract/products.v1.json`.
2. Run `npm run validate`.
3. Update each product-specific projection (dashboard routes, backend rules,
   worker handler, and CDK resources) in the same release train.
4. Pin the resulting commit in each repository and let CI reject divergence.

For an asynchronous capability, also add a typed runtime message fixture and
an `async-delegation` handoff/outcome projection. The API records the intent
and outbox event atomically; each specialist runtime owns only its dedicated
queue and reports an idempotent, queryable outcome. A runtime must never call
or publish directly into another runtime's queue.

`npm run catalog:dashboard` renders the data-only dashboard catalog. Product
routes and UI behavior remain local intentionally; they are implementation,
not shared deployment identity.

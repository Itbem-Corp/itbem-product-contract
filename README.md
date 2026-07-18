# ITBEM Product Contract

This is the versioned, language-neutral source of truth for product identity,
capabilities, public entry points, Cognito environment keys and worker topics.
It contains no credentials, account IDs, database configuration or runtime
secrets.

Each deployable repository pins a contract revision and validates its local
projection during CI. Runtime services keep generated/static definitions: no
request makes a network call to load this contract, so adding governance does
not alter API or dashboard latency.

## Change process

1. Add or update one entry in `contract/products.v1.json`.
2. Run `npm run validate`.
3. Update each product-specific projection (dashboard routes, backend rules,
   worker handler, and CDK resources) in the same release train.
4. Pin the resulting commit in each repository and let CI reject divergence.

`npm run catalog:dashboard` renders the data-only dashboard catalog. Product
routes and UI behavior remain local intentionally; they are implementation,
not shared deployment identity.

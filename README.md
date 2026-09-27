# NuBlox SQL Workbench

NuBlox SQL Workbench is a database engineering environment for SQL development, database exploration, schema engineering, data operations, administration, migration and metadata-driven modelling.

Development is organised as a modular TypeScript monorepo. Database-specific behaviour is provided through capability-driven providers so that the Workbench can support MySQL first without embedding MySQL assumptions into the application core.

## Current foundation

The repository now contains:

- `@nublox/sql-workbench-core` — database-neutral provider, capability, connection/session and query-result contracts.
- `@nublox/sql-workbench-provider-mysql` — the first provider boundary and MySQL capability roadmap.
- `docs/architecture/overview.md` — package boundaries, integration rules and implementation sequence.
- `docs/product/database-personas.md` — database roles, jobs-to-be-done and product capability domains.
- CI for type checking, building and tests on Node.js 22.

The MySQL provider is intentionally registered with **planned** capabilities only until its runtime is connected to `@nublox/mysql`. Planned capability declarations never enable runtime functionality.

## Related NuBlox packages

- [`@nublox/mysql`](https://github.com/NuBlox/NuBloxSQL) — mastered MySQL protocol/client package.
- [`@nublox/metaobject`](https://github.com/NuBlox/metaobject) — standalone metadata-driven object model and runtime.

SQL Workbench consumes these packages; it does not duplicate their responsibilities.

## Development

```bash
corepack enable
pnpm install
pnpm verify
```

Requirements: Node.js 22 or newer.

## Next milestone

Implement the MySQL provider runtime using `@nublox/mysql`, including connection lifecycle, SQL execution, transactions, cancellation/timeout handling, result normalization and initial schema introspection.

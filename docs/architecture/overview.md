# Architecture Overview

## Purpose

NuBlox SQL Workbench is the product layer above NuBlox database and metadata packages. It coordinates database connections, SQL authoring and execution, schema exploration, administration, migration, data operations and metadata-driven modelling without making the application core depend on one database engine.

## Package boundaries

```text
NuBlox SQL Workbench
├── @nublox/sql-workbench-core
│   ├── provider contracts
│   ├── capability model
│   ├── provider registry
│   ├── connection/session contracts
│   └── query result contracts
├── @nublox/sql-workbench-provider-mysql
│   └── MySQL-specific provider implementation
├── future providers
│   ├── PostgreSQL
│   ├── SQLite
│   ├── SQL Server
│   └── Oracle
└── future product shells
    ├── desktop/web workbench
    └── CLI/automation surface
```

Related NuBlox packages remain independent:

- `@nublox/mysql` owns MySQL protocol/client behaviour and will be used by the MySQL provider runtime.
- `@nublox/metaobject` owns database-neutral metadata-driven object modelling. SQL Workbench will integrate it for modelling, generation and schema evolution workflows rather than duplicating its kernel.

## Provider model

The Workbench core does not ask whether a provider is MySQL, PostgreSQL or another engine before enabling a feature. It asks whether the registered provider implements a capability.

Examples include:

- `sql.execution`
- `sql.transactions`
- `sql.explain`
- `schema.introspection`
- `schema.ddl`
- `data.browse`
- `admin.sessions`
- `admin.users`
- `operations.backup`
- `metadata.modelling`

`capabilities` contains functionality implemented and safe to enable. `plannedCapabilities` is roadmap information only and must never enable runtime controls.

## Security boundary

Connection profiles contain connection metadata, not durable secrets. Passwords and future tokens/keys must be supplied by an external secret mechanism or secure credential store. The core contracts therefore keep profile data separate from connection-time credentials.

## Initial implementation sequence

1. Provider contracts and registry.
2. MySQL runtime using `@nublox/mysql`.
3. Connection manager and session lifecycle.
4. SQL editor execution pipeline and result model.
5. MySQL schema/catalog introspection.
6. Object explorer and data browser.
7. Explain-plan and performance tooling.
8. Administration surfaces for sessions, variables, users and privileges.
9. Import/export, backup/restore and migration workflows.
10. `@nublox/metaobject` modelling and schema-evolution integration.
11. Additional database providers using the same capability contracts.

## Architectural rules

1. No database-specific SQL or protocol behaviour in `@nublox/sql-workbench-core`.
2. A UI feature must be gated by an implemented provider capability.
3. Provider-specific extensions are allowed but must not leak into core contracts unless they can be expressed generically.
4. Secrets are never persisted in plain connection-profile objects.
5. Metadata modelling remains delegated to `@nublox/metaobject`.
6. MySQL wire-protocol behaviour remains delegated to `@nublox/mysql`.
7. Tests must verify capability gating and provider isolation as providers are added.

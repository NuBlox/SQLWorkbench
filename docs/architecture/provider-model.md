# Database Provider Model

A `DatabaseProvider` is the only database-specific boundary visible to Workbench core.

Every provider declares capabilities, opens sessions, introspects its server into the normalized catalogue, executes SQL, explains SQL and quotes identifiers.

## Capability-driven UI

The UI must ask the active provider what it can do. It must not encode checks such as `if provider === "mysql"` for ordinary feature enablement.

Examples of provider capabilities include:

- catalog and schema discovery;
- views;
- indexes and foreign keys;
- routines and triggers;
- transactions and savepoints;
- explain plans;
- query cancellation;
- server administration;
- user/role administration.

## Session ownership

A provider owns the native connection/pool object. Workbench core receives an opaque `DatabaseSession` with lifecycle and health operations. This prevents driver implementation types leaking through every package.

## Normalized catalogues

Provider introspection returns `DatabaseCatalog` objects. For MySQL, a MySQL database maps to a catalogue namespace with a `catalog` value and no separate `schema` value. PostgreSQL and SQL Server providers can populate both database/catalog and schema values without changing Workbench consumers.

## SQL dialect services

Dialect-aware parsing, formatting, completion and static analysis will be added as separate services. Database execution remains a provider responsibility; the editor must not depend directly on driver packages.

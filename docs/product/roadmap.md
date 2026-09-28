# Product Roadmap

The application UX and feature prioritisation should be informed by the database jobs and personas defined in [`database-personas.md`](database-personas.md).

## M0 — Foundation

- [x] Monorepo and CI structure
- [x] Normalized catalogue
- [x] Database provider API
- [x] Provider registry
- [x] Connection manager
- [x] Query service
- [x] MySQL provider backed by published `@nublox/mysql`
- [x] MySQL catalogue introspection baseline
- [x] Database persona and jobs-to-be-done model
- [x] Persistent connection-profile model
- [x] Secure credential-store abstraction
- [x] Production OS-backed credential-store implementation

## M1 — Desktop SQL development

- [x] Electron desktop shell
- [x] Svelte renderer
- [x] application-data path integration for connection profiles
- [x] OS keychain/credential-store adapter
- [x] persona-aware workspace/navigation model
- [x] connection selector and live connection lifecycle
- [x] Monaco SQL editor
- [x] execute statement / selection / script
- [x] query cancellation
- [x] result grid and multiple results
- [x] messages and execution timing
- [x] query history
- [x] CSV/JSON export
- [x] secure custom-protocol prerendered desktop entry point
- [x] renderer build-output regression test

## M2 — Database explorer

- [x] lazy tree loading
- [x] databases/schemas
- [x] tables and views
- [x] columns
- [x] indexes
- [x] foreign keys
- [x] procedures/functions
- [x] triggers/events
- [x] users/roles/privileges
- [x] object search

## M3 — Metaobject bridge

- [x] reverse-engineer physical tables to metaobject draft definitions
- [x] map foreign keys to relationships
- [x] preserve physical-name mappings
- [x] compare physical schema with logical metadata
- [x] generate database-neutral schema-change plans
- [x] feed migration plans into database providers

## M4 — Schema engineering

- [x] table structural editor
- [x] view definition editor
- [x] ER dependency visualization
- [x] interactive visual ER modelling
- [x] forward engineering
- [x] schema diff
- [x] migration generation
- [x] dependency analysis
- [x] DDL preview
- [x] guarded live DDL execution with stale-preview fingerprint protection

## M5 — Query engineering

- [x] dialect-aware parser services
- [x] completion from live catalogue metadata
- [x] positioned syntax diagnostics
- [x] semantic linting and diagnostics
- [x] formatting
- [x] visual query builder
- [x] explain-plan visualization
- [x] query statistics and plan history

## M6 — Administration and operations

- [x] sessions/processes
- [x] locks and blocking
- [x] server variables/status
- [x] users, roles and fine-grained privileges
- [x] storage/capacity inspection
- [x] logical table import/export
- [x] backup/restore hooks where supported (Workbench JSON available; external `mysqldump` explicitly unconfigured)
- [x] data compare and guarded transfer
- [x] provider capability contracts for administration/operations features

## 0.1.0 Release Candidate

- [x] MySQL product path complete through M6
- [x] npm package boundaries for `@nublox/mysql` and `@nublox/metaobject`
- [x] startup diagnostics and secure renderer protocol
- [x] guarded destructive schema/security/data operations
- [x] installable desktop packaging configuration
- [x] cross-platform RC artifact workflow
- [ ] signed/notarized production distribution (post-RC hardening)

## Provider expansion

Provider priority does not alter the database-neutral core contract.

### PostgreSQL

- [x] provider package and `pg` driver boundary
- [x] secure pooled connection/session lifecycle
- [x] positional SQL execution and JSON EXPLAIN baseline
- [x] database/schema/table/column/index/foreign-key catalogue introspection baseline
- [x] lazy namespace/object/table explorer baseline
- [x] routines, triggers, principals, roles and privileges
- [x] object search
- [x] query cancellation and per-query timeout control
- [x] migration and view-engineering adapters
- [ ] administration/operations adapter
- [ ] desktop provider registration and connection UX
- [ ] integration tests against supported PostgreSQL versions

### Next providers

1. SQLite
2. SQL Server
3. Oracle

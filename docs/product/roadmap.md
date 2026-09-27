# Product Roadmap

The application UX and feature prioritisation should be informed by the database jobs and personas defined in [`database-personas.md`](database-personas.md).

## M0 — Foundation

- [x] Monorepo and CI structure
- [x] Normalized catalogue
- [x] Database provider API
- [x] Provider registry
- [x] Connection manager
- [x] Query service
- [x] MySQL provider backed by NuBloxSQL
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
- [ ] feed migration plans into database providers

## M4 — Schema engineering

- [ ] table/view editors
- [ ] visual ER modelling
- [ ] forward engineering
- [ ] schema diff
- [ ] migration generation
- [ ] dependency analysis
- [ ] DDL preview and guarded execution

## M5 — Query engineering

- [ ] dialect-aware parser services
- [ ] completion from live catalogue metadata
- [ ] linting and diagnostics
- [ ] formatting
- [ ] visual query builder
- [ ] explain-plan visualization
- [ ] query statistics and plan history

## M6 — Administration and operations

- [ ] sessions/processes
- [ ] locks and blocking
- [ ] server variables/status
- [ ] users, roles and fine-grained privileges
- [ ] storage/capacity inspection
- [ ] import/export
- [ ] backup/restore hooks where supported
- [ ] data compare and transfer
- [ ] provider capability contracts for administration/operations features

## Provider expansion

After the MySQL product path is stable:

1. PostgreSQL
2. SQLite
3. SQL Server
4. Oracle

Provider priority does not alter the database-neutral core contract.

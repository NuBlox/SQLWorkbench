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
- [ ] Production OS-backed credential-store implementation

## M1 — Desktop SQL development

- Electron desktop shell
- Svelte renderer
- application-data path integration for connection profiles
- OS keychain/credential-store adapter
- persona-aware workspace/navigation model
- Monaco SQL editor
- connection selector
- execute statement / selection / script
- query cancellation
- result grid and multiple results
- messages and execution timing
- query history
- CSV/JSON export

## M2 — Database explorer

- lazy tree loading
- databases/schemas
- tables and views
- columns
- indexes
- foreign keys
- procedures/functions
- triggers/events
- users/roles/privileges
- object search

## M3 — Metaobject bridge

- reverse-engineer physical tables to metaobject draft definitions
- map foreign keys to relationships
- preserve physical-name mappings
- compare physical schema with logical metadata
- generate database-neutral schema-change plans
- feed migration plans into database providers

## M4 — Schema engineering

- table/view editors
- visual ER modelling
- forward engineering
- schema diff
- migration generation
- dependency analysis
- DDL preview and guarded execution

## M5 — Query engineering

- dialect-aware parser services
- completion from live catalogue metadata
- linting and diagnostics
- formatting
- visual query builder
- explain-plan visualization
- query statistics and plan history

## M6 — Administration and operations

- sessions/processes
- locks and blocking
- server variables/status
- users, roles and fine-grained privileges
- storage/capacity inspection
- import/export
- backup/restore hooks where supported
- data compare and transfer
- provider capability contracts for administration/operations features

## Provider expansion

After the MySQL product path is stable:

1. PostgreSQL
2. SQLite
3. SQL Server
4. Oracle

Provider priority does not alter the database-neutral core contract.

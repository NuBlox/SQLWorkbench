# Administration and operations architecture

NuBlox SQL Workbench exposes database administration through provider-neutral contracts. The Electron renderer never issues vendor administration SQL directly.

## Capability model

`DatabaseCapabilities.administration` advertises fine-grained operational support. The current MySQL slice enables:

- server session/process inspection;
- live lock-wait and blocking inspection;
- global server-variable inspection;
- global server-status inspection.

User administration, storage/capacity, import/export, backup/restore and data transfer remain explicit unsupported capabilities until their provider implementations land.

## Execution boundary

The renderer calls the typed preload API. Electron IPC forwards requests to `DesktopAdministrationService`, which resolves the active Workbench connection and checks the provider capability before invoking `DatabaseAdministrationProvider`.

The MySQL implementation delegates SQL execution back through `MySqlDatabaseProvider.execute`, so result normalization and the published `@nublox/mysql` driver boundary remain unchanged.

## MySQL data sources

The administration workspace uses:

- `INFORMATION_SCHEMA.PROCESSLIST` for visible sessions/processes;
- `performance_schema.data_lock_waits` for wait-for relationships;
- `performance_schema.data_locks` for requested lock object/type/mode metadata;
- `performance_schema.threads` and `events_statements_current` for waiting/blocking process identities and visible waiting SQL;
- `SHOW GLOBAL VARIABLES` for server configuration;
- `SHOW GLOBAL STATUS` for runtime counters/status.

Lock and transaction metadata is inherently a point-in-time operational snapshot. Rows can disappear or change while the administration screen is being refreshed, so the UI presents each refresh as observation data rather than durable state.

MySQL visibility and privilege rules apply. Users without broad process/performance-schema privileges may see only a subset of sessions or lock metadata. This is intentional: SQL Workbench does not bypass database authorization.

## Safety

This slice is read-only. It does not terminate sessions, kill blocking statements, mutate global variables, grant privileges or execute backup/restore commands. Future mutating administration operations must use explicit capability checks and guarded confirmation flows comparable to schema engineering.

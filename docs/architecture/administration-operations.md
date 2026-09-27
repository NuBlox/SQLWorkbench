# Administration and operations architecture

NuBlox SQL Workbench exposes database administration through provider-neutral contracts. The Electron renderer never issues vendor administration SQL directly.

## Capability model

`DatabaseCapabilities.administration` advertises fine-grained operational support. The first MySQL slice enables:

- server session/process inspection;
- global server-variable inspection;
- global server-status inspection.

Lock inspection, user administration, storage/capacity, import/export, backup/restore and data transfer remain explicit unsupported capabilities until their provider implementations land.

## Execution boundary

The renderer calls the typed preload API. Electron IPC forwards requests to `DesktopAdministrationService`, which resolves the active Workbench connection and checks the provider capability before invoking `DatabaseAdministrationProvider`.

The MySQL implementation delegates SQL execution back through `MySqlDatabaseProvider.execute`, so result normalization and the published `@nublox/mysql` driver boundary remain unchanged.

## MySQL data sources

The baseline uses:

- `INFORMATION_SCHEMA.PROCESSLIST` for visible sessions/processes;
- `SHOW GLOBAL VARIABLES` for server configuration;
- `SHOW GLOBAL STATUS` for runtime counters/status.

MySQL visibility and privilege rules apply. Users without broad process privileges may see only their own sessions. This is intentional: SQL Workbench does not bypass database authorization.

## Safety

This slice is read-only. It does not terminate sessions, mutate global variables, grant privileges or execute backup/restore commands. Future mutating administration operations must use explicit capability checks and guarded confirmation flows comparable to schema engineering.

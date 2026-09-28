# Administration and operations architecture

NuBlox SQL Workbench exposes database administration through provider-neutral contracts. The Electron renderer never issues vendor administration SQL directly and never receives filesystem handles.

## Capability model

`DatabaseCapabilities.administration` advertises fine-grained operational support. The MySQL 0.1.0 RC enables:

- server session/process inspection;
- live lock-wait and blocking inspection;
- global server-variable and server-status inspection;
- users, roles and privilege inspection;
- guarded GRANT/REVOKE privilege and role changes;
- storage/capacity inspection;
- logical table JSON export/import;
- table shape/count comparison and guarded transfer;
- provider backup-hook discovery.

## Execution boundary

The renderer calls typed preload APIs. Electron IPC forwards requests to `DesktopAdministrationService`, which resolves the active Workbench connection, checks the provider capability and invokes `DatabaseAdministrationProvider`.

Higher-risk M6 operations are isolated on the `nubloxOperations` context bridge instead of widening the ordinary query/explorer bridge. Native file dialogs, JSON file reads/writes and all database mutations stay in the Electron main process.

The MySQL implementation delegates SQL execution through `MySqlDatabaseProvider.execute`, so normalization and the published `@nublox/mysql` driver boundary remain unchanged.

## MySQL data sources

The administration workspace uses:

- `INFORMATION_SCHEMA.PROCESSLIST` for visible sessions/processes;
- `performance_schema.data_lock_waits` and `data_locks` for wait-for relationships and requested lock metadata;
- `performance_schema.threads`, `events_statements_current` and `INFORMATION_SCHEMA.INNODB_TRX` for process identity, waiting SQL and wait duration;
- `SHOW GLOBAL VARIABLES` and `SHOW GLOBAL STATUS` for server configuration/runtime values;
- `mysql.user`, `mysql.role_edges` and `mysql.default_roles` for account/role metadata;
- `INFORMATION_SCHEMA.USER_PRIVILEGES`, `SCHEMA_PRIVILEGES` and `TABLE_PRIVILEGES` for visible grants;
- `INFORMATION_SCHEMA.TABLES` for storage/capacity summaries;
- `INFORMATION_SCHEMA.COLUMNS` for table-transfer compatibility inspection.

Operational metadata is point-in-time observation data. Rows can disappear or change during refresh. MySQL visibility and privilege rules apply; SQL Workbench does not bypass server authorization.

## Security mutation guard

The renderer submits a structured `DatabaseSecurityChange`, never raw account DDL. The MySQL adapter:

1. validates MySQL `'user'@'host'` account syntax;
2. restricts privileges to an explicit allowlist;
3. quotes database/table identifiers;
4. generates a preview statement;
5. marks revokes as destructive/restrictive;
6. requires an exact main-process confirmation phrase before execution.

The confirmation is `APPLY SECURITY CHANGE` for grants and `APPLY SECURITY REVOKE` for revokes.

## Data operations

Workbench JSON exports carry a catalog, table, ordered column list and rows. File access is owned by Electron native dialogs. Imports use prepared inserts and may optionally truncate the target table first. Direct table transfer is independently guarded by the exact phrase `TRANSFER DATA`.

The RC comparison baseline intentionally compares table column shape and row counts. It does not claim row-by-row semantic diffing yet.

## Backup hooks

The MySQL provider advertises two hooks:

- `workbench-json`: available, providing portable table-level logical backup/restore through the same guarded import/export path;
- `mysqldump`: discoverable but unavailable until an executable is explicitly configured in a future hardening increment.

The RC never executes an arbitrary system binary or silently assumes that `mysqldump` exists.

## Safety constraints

- Lock/process inspection is read-only; the RC does not terminate sessions.
- Server variables/status remain read-only.
- Security changes require generated preview plus exact confirmation.
- Data transfer requires its own confirmation phrase.
- Import/export never exposes arbitrary filesystem APIs to the renderer.
- External full-database backup commands are disabled unless explicitly configured in a future release.

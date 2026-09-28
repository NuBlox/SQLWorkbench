# Administration and operations architecture

NuBlox SQL Workbench exposes database administration through provider-neutral contracts. The Electron renderer never issues vendor administration SQL, filesystem operations or backup subprocesses directly.

## Capability model

`DatabaseCapabilities.administration` advertises fine-grained operational support. The MySQL RC path enables:

- server session/process inspection;
- live lock-wait and blocking inspection;
- global server-variable and server-status inspection;
- users, roles, privilege inspection and guarded grant/revoke/role mutation;
- storage/capacity inspection;
- bounded table import/export;
- MySQL logical backup/restore hooks;
- bounded data comparison and guarded append transfer.

Providers can implement these capabilities independently. Desktop code checks the capability and provider method before every operation.

## Execution boundary

The renderer calls the typed preload API. Electron IPC forwards read-only operational requests to `DesktopAdministrationService` and higher-risk operations to `DesktopOperationsService`. Both resolve the active Workbench connection and invoke `DatabaseAdministrationProvider`; neither embeds MySQL administration SQL.

The MySQL implementation delegates live SQL execution back through `MySqlDatabaseProvider.execute`, so normalization and the published `@nublox/mysql` driver boundary remain unchanged.

## MySQL data sources

The administration workspace uses:

- `INFORMATION_SCHEMA.PROCESSLIST` for visible sessions/processes;
- `performance_schema.data_lock_waits` for wait-for relationships;
- `performance_schema.data_locks` for requested lock object/type/mode metadata;
- `performance_schema.threads`, `events_statements_current` and `INFORMATION_SCHEMA.INNODB_TRX` for process identities, waiting SQL and wait duration;
- `SHOW GLOBAL VARIABLES` for server configuration;
- `SHOW GLOBAL STATUS` for runtime counters/status;
- `mysql.user`, `mysql.role_edges` and `mysql.default_roles` for account/role metadata;
- `INFORMATION_SCHEMA.USER_PRIVILEGES`, `SCHEMA_PRIVILEGES`, `TABLE_PRIVILEGES` and `COLUMN_PRIVILEGES` for fine-grained grants;
- `INFORMATION_SCHEMA.TABLES` for storage/capacity estimates.

Operational metadata is point-in-time state. Rows can disappear or change while the Administration screen refreshes, so refresh output is observational rather than durable state.

MySQL visibility and privilege rules apply. SQL Workbench does not attempt to bypass database authorization.

## Guarded security mutation

The renderer submits a provider-neutral `DatabaseSecurityChange`. The provider generates the exact SQL preview; `DesktopOperationsService` fingerprints connection, requested change and preview statements. Execution requires the same fingerprint and an exact confirmation phrase:

- `APPLY SECURITY CHANGE` for additive operations;
- `APPLY DESTRUCTIVE SECURITY CHANGE` for role/privilege removal.

The renderer never concatenates or executes account DDL itself. MySQL account names, hosts, privileges and object identifiers are validated/quoted by the provider.

## Data I/O and transfer

RC data operations are deliberately bounded to 10,000 rows per operation:

- JSON and CSV export reads a bounded provider result set;
- CSV export neutralizes spreadsheet-formula prefixes;
- JSON import accepts only an array of objects with a consistent ordered column set;
- data comparison uses canonical row multisets and reports matching/left-only/right-only counts;
- transfer rereads the source, verifies a SHA-256 preview fingerprint and requires `TRANSFER DATA` before appending rows to the target.

This RC does not attempt bulk-loader semantics, automatic primary-key reconciliation, UPSERT/merge behavior or destructive synchronization.

## Backup and restore hooks

MySQL backup/restore is modelled as a provider-generated external-tool plan:

- backup uses `mysqldump` and streams stdout to a user-selected file;
- restore uses `mysql` and streams a user-selected SQL file to stdin;
- the password is passed only in the spawned child-process environment (`MYSQL_PWD`) and is never placed in the command arguments;
- restore requires the exact phrase `RESTORE DATABASE`.

The MySQL command-line tools must be installed and available on `PATH`. This is an operational hook, not an embedded binary backup engine.

## Release-candidate safety boundary

The RC deliberately does **not** expose session termination, global-variable mutation, destructive data synchronization or automated backup scheduling. Those operations require separate capability contracts and guard design before implementation.

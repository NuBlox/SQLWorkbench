# Query Execution Architecture

NuBlox SQL Workbench keeps SQL authoring in the renderer and database execution in the Electron main process.

## Boundary

```text
Monaco SQL editor
      |
      | typed contextBridge request
      v
Electron main process
      |
      v
DesktopServices
      |
      v
QueryService
      |
      v
DatabaseProvider
```

The renderer never receives a database driver, pool, session object, filesystem handle or `AbortController`.

## Execution modes

The desktop API exposes three user-facing run modes:

- `statement` — execute the statement under the Monaco cursor;
- `selection` — execute the current Monaco selection;
- `script` — split an ordinary SQL script at semicolons outside quoted strings, identifiers and comments, then execute each statement sequentially.

Script splitting deliberately does not enable a provider's multi-statement connection option globally. This keeps connection defaults conservative and makes script orchestration a Workbench responsibility. Provider-specific delimiter directives for stored-program authoring remain future dialect-service work.

## Cancellation

Every execution receives a renderer-generated execution ID. The main process creates and retains the corresponding `AbortController` and passes only its signal into the provider through `QueryService`.

A cancel request contains the execution ID only. The main process aborts the matching controller. Disconnecting a profile aborts active executions for that connection, and application shutdown aborts every active execution before closing database sessions.

## Result normalization

Provider values are normalized before crossing the Electron bridge:

- strings, finite numbers and booleans remain native;
- `NULL`/undefined become `null`;
- bigint values become decimal strings;
- dates become ISO strings;
- binary values become hexadecimal strings;
- complex values are JSON-serialized where possible.

This prevents driver-specific objects from leaking into the renderer and keeps result export deterministic.

## Query history

History is stored beneath Electron's application-data directory in `query-history.json`.

The store:

- writes atomically through a temporary file and rename;
- uses owner-only POSIX permissions where supported;
- retains a bounded newest-first history;
- records connection/profile ID, SQL text, run mode, timing, statement/result-set counts and outcome;
- does not store connection credentials or TLS private keys.

SQL text itself may contain sensitive literals, so history is application-private data and should be treated accordingly. A later preferences surface can add per-user retention and history-disable controls.

## Export

The renderer sends only the selected normalized result set to the main process. The main process owns the native save dialog and filesystem write.

CSV export follows conventional quoting rules and prefixes text beginning with `=`, `+`, `-` or `@` with an apostrophe to reduce spreadsheet-formula injection risk. JSON export preserves the normalized result representation and execution summary fields.

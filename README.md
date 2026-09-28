# NuBlox SQL Workbench

NuBlox SQL Workbench is a database engineering environment for SQL development, database exploration, schema engineering, data operations, administration, migration and metadata-driven modelling.

> Current release line: **0.2.0-rc.1**. See [`docs/releases/0.2.0-rc.1.md`](docs/releases/0.2.0-rc.1.md) for release-candidate scope and test guidance.

The product is intentionally separate from the packages it consumes:

- [`NuBlox/NuBloxSQL`](https://github.com/NuBlox/NuBloxSQL) supplies the first database driver implementation through `@nublox/mysql`.
- [`NuBlox/metaobject`](https://github.com/NuBlox/metaobject) supplies the metadata-driven object/runtime model used by Workbench modelling and schema-evolution capabilities.
- `NuBlox/SQLWorkbench` owns desktop UX, database-provider orchestration, normalized catalogues, SQL execution workflows, modelling and administration.

## Architecture

```text
Electron / Svelte Workbench UI
              |
        typed preload API
              |
              v
       Workbench Core
              |
       Provider Registry
              |
    +---------+---------+
    |                   |
    v                   v
MySQL Provider      Future Providers
    |                   |
    v                   v
@nublox/mysql       PostgreSQL / SQLite /
                    SQL Server / Oracle
              |
              v
      Normalized Catalogue
              |
              +------------------+
              |                  |
              v                  v
       Metaobject Bridge   Query Engineering
              |                  |
              v                  v
     @nublox/metaobject    parser / diagnostics /
                          live completion
```

The provider boundary is capability-driven. Workbench core code must not contain MySQL-specific branching.

## Release-candidate capability set

- Electron desktop shell with context isolation, renderer sandboxing, CSP-hashed Svelte assets and a typed preload bridge;
- Svelte 5 / SvelteKit desktop renderer;
- persistent connection profiles with OS-backed credential encryption;
- MySQL provider backed by published `@nublox/mysql@3.1.0-rc.1`;
- published `@nublox/metaobject@1.0.0-rc.1` integration through the Workbench metaobject bridge;
- Monaco SQL editor, statement/selection/script execution, cancellation, multiple result sets, history and CSV/JSON export;
- database explorer for schemas, tables/views, columns, indexes, foreign keys, routines, triggers/events, users/roles/privileges and object search;
- schema, view and interactive ER engineering with provider DDL preview and guarded stale-preview execution;
- parser-backed SQL diagnostics, semantic linting, live-catalogue IntelliSense, formatting and visual query building;
- explain-plan visualization, persisted plan history and query statistics;
- Administration workspace for sessions/processes, locks/blocking, server variables/status, users/roles/privileges and storage/capacity;
- guarded role/grant/revoke operations with exact SQL preview and confirmation fingerprints;
- bounded JSON/CSV data export, JSON import, data compare and guarded append transfer;
- MySQL logical backup/restore hooks using `mysqldump` and `mysql` without placing database passwords in command-line arguments;
- cross-platform RC packaging for macOS, Windows and Linux.

See [`docs/product/roadmap.md`](docs/product/roadmap.md) for delivery status and provider expansion.

See [`docs/product/database-personas.md`](docs/product/database-personas.md) for the database roles, jobs-to-be-done, capability mapping and persona-oriented workspace model that shapes the application UX.

See [`docs/architecture/connection-profiles.md`](docs/architecture/connection-profiles.md) for the connection-profile and credential security boundary.

See [`docs/architecture/query-execution.md`](docs/architecture/query-execution.md) for the editor, execution, cancellation, history and export boundary.

See [`docs/architecture/query-language-intelligence.md`](docs/architecture/query-language-intelligence.md) for the query parser, diagnostics and live-catalogue completion architecture.

See [`docs/architecture/administration-operations.md`](docs/architecture/administration-operations.md) for the administration provider boundary and safety model.

## Development

Requirements:

- Node.js 22 or later;
- Corepack/pnpm.

```bash
corepack enable
pnpm install
pnpm check
```

Build and launch the desktop application:

```bash
pnpm --filter @nublox/sql-workbench-desktop start
```

Build native packages for the current operating system:

```bash
pnpm package:desktop
```

Packages are written beneath `apps/desktop/release/`.

The MySQL provider consumes the published NuBloxSQL package, while the metaobject bridge consumes the published Metaobject package. SQL Workbench keeps both package boundaries explicit so each repository can evolve independently.

## Distribution status

The RC workflow produces macOS, Windows and Linux test artifacts. These release-candidate packages may be unsigned. Production distribution requires platform code signing; macOS production packages additionally require Apple notarization. No signing or notarization status should be inferred from an unsigned RC artifact.

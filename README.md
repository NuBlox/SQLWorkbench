# NuBlox SQL Workbench

NuBlox SQL Workbench is a database engineering environment for SQL development, database exploration, schema engineering, data operations, administration, migration and metadata-driven modelling.

**Current release line: `0.1.0-rc.2` (MySQL-focused release candidate).**

The product is intentionally separate from the packages it consumes:

- [`NuBlox/NuBloxSQL`](https://github.com/NuBlox/NuBloxSQL) supplies the MySQL driver through published `@nublox/mysql@3.1.0-rc.1`.
- [`NuBlox/metaobject`](https://github.com/NuBlox/metaobject) supplies the metadata-driven object/runtime model through published `@nublox/metaobject@1.0.0-rc.1`.
- `NuBlox/SQLWorkbench` owns desktop UX, database-provider orchestration, normalized catalogues, SQL execution workflows, modelling and administration.

## Architecture

```text
Electron / Svelte Workbench UI
              |
        typed preload APIs
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

## Release-candidate capability

The MySQL product path is implemented through M6:

- secure Electron/Svelte desktop shell with custom local protocol, CSP and startup diagnostics;
- persistent connection profiles and OS-backed credential encryption;
- Monaco SQL editor, statement/selection/script execution, cancellation, result grids, history and CSV/JSON export;
- lazy database explorer for schemas, relations, columns, indexes, foreign keys, routines, triggers/events and security metadata;
- reverse engineering into `@nublox/metaobject`, logical/physical comparison and provider migration handoff;
- table, view and interactive ER schema engineering with DDL preview and stale-preview guarded live execution;
- dialect-aware parser services, live-catalogue completion, syntax/semantic diagnostics, formatting and visual query building;
- explain-plan visualization, plan history and query statistics;
- sessions/processes, lock/blocking diagnostics, server variables/status;
- users/roles/privileges inspection and guarded GRANT/REVOKE operations;
- storage/capacity inspection;
- native-dialog Workbench JSON table import/export;
- table shape/count comparison and guarded table transfer;
- provider backup-hook discovery with logical Workbench JSON available and external `mysqldump` intentionally unconfigured.

See [`docs/product/roadmap.md`](docs/product/roadmap.md) and [`docs/releases/0.1.0-rc.2.md`](docs/releases/0.1.0-rc.2.md).

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

Build an unpacked desktop package for verification:

```bash
pnpm --filter @nublox/sql-workbench-desktop package:dir
```

Build the current-platform RC artifact manually:

```bash
# macOS
pnpm --filter @nublox/sql-workbench-desktop package:mac

# Linux
pnpm --filter @nublox/sql-workbench-desktop package:linux

# Windows
pnpm --filter @nublox/sql-workbench-desktop package:win
```

The tag-triggered GitHub **Release Candidate** workflow builds macOS ZIP, Linux AppImage and Windows portable artifacts and publishes them to a GitHub prerelease. Release-branch pull requests run the same three platform packaging targets before merge.

RC binaries are not yet code-signed/notarized. Signing/notarization and installer hardening are post-RC work.

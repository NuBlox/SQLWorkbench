# NuBlox SQL Workbench

NuBlox SQL Workbench is a database engineering environment for SQL development, database exploration, schema engineering, data operations, administration, migration and metadata-driven modelling.

The product is intentionally separate from the packages it consumes:

- [`NuBlox/NuBloxSQL`](https://github.com/NuBlox/NuBloxSQL) supplies the first database driver implementation through `@nublox/mysql`.
- [`NuBlox/metaobject`](https://github.com/NuBlox/metaobject) supplies the metadata-driven object/runtime model that later Workbench modelling and schema-evolution capabilities will bridge to.
- `NuBlox/SQLWorkbench` owns desktop UX, database-provider orchestration, normalized catalogues, SQL execution workflows, modelling and administration.

## Architecture

```text
Svelte / Electron desktop application
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
              v
       Metaobject Bridge
              |
              v
     @nublox/metaobject
```

The provider boundary is capability-driven. Workbench core code must not contain MySQL-specific branching.

## Implemented foundation

- normalized database catalogue package;
- database-provider contract;
- provider registry, connection manager and query service;
- persistent, revisioned connection-profile repository;
- credential-store abstraction that keeps passwords and TLS private keys outside profile persistence;
- Electron desktop shell with a static SvelteKit/Svelte renderer;
- operating-system encrypted credential persistence through Electron `safeStorage`;
- secure preload/contextBridge IPC boundary;
- connection-management workspace with create/edit/delete/connect/disconnect flows;
- live session health display;
- first MySQL provider backed by `@nublox/mysql`;
- MySQL connection health verification;
- query execution and result normalization;
- cancellation for text queries through NuBloxSQL `AbortSignal` support;
- MySQL `EXPLAIN FORMAT=JSON` support;
- lazy-ready INFORMATION_SCHEMA introspection for databases, tables/views, columns, indexes and foreign keys;
- CI build and unit-test workflow.

See [`docs/product/roadmap.md`](docs/product/roadmap.md) for the delivery sequence.

See [`docs/product/database-personas.md`](docs/product/database-personas.md) for the database roles, jobs-to-be-done, capability mapping and persona-oriented workspace model that shapes the application UX.

See [`docs/architecture/connection-profiles.md`](docs/architecture/connection-profiles.md) for the connection-profile security boundary and [`docs/architecture/desktop-application.md`](docs/architecture/desktop-application.md) for the Electron/Svelte process model.

## Development

Requirements:

- Node.js 22 or later;
- Corepack/pnpm.

```bash
corepack enable
pnpm install
pnpm check
```

To open the built desktop application:

```bash
pnpm --filter @nublox/sql-workbench-desktop start
```

The MySQL provider currently pins the exact NuBloxSQL Git commit it was developed against so Workbench builds remain reproducible while both repositories are moving quickly.

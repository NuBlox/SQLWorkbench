# NuBlox SQL Workbench

NuBlox SQL Workbench is a database engineering environment for SQL development, database exploration, schema engineering, data operations, administration, migration and metadata-driven modelling.

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

## Implemented product foundation

- Electron desktop shell with context isolation, renderer sandboxing and a typed preload bridge;
- Svelte 5 / SvelteKit desktop renderer;
- normalized database catalogue package;
- database-provider contract;
- provider registry, connection manager and query service;
- persistent, revisioned connection-profile repository;
- OS-backed credential encryption that keeps passwords and TLS private keys outside profile persistence;
- first MySQL provider backed by published `@nublox/mysql@3.1.0-rc.1`;
- published `@nublox/metaobject@1.0.0-rc.1` integration through the Workbench metaobject bridge;
- connection health verification and live connection lifecycle;
- Monaco SQL editor;
- current-statement, selection and sequential script execution;
- live query cancellation;
- multiple result sets and tabular result rendering;
- persistent bounded query history;
- CSV and JSON result export;
- MySQL `EXPLAIN FORMAT=JSON` support in the provider layer;
- INFORMATION_SCHEMA introspection for databases, tables/views, columns, indexes and foreign keys;
- M3 logical/physical metadata bridge and M4 schema engineering;
- provider-aware query-language service with MySQL syntax parsing;
- positioned Monaco parser diagnostics;
- grammar-aware SQL keyword completion;
- live catalogue completion for tables, views and columns;
- automatic IntelliSense metadata refresh after schema-changing SQL;
- CI build, Svelte diagnostics and unit tests.

See [`docs/product/roadmap.md`](docs/product/roadmap.md) for the delivery sequence.

See [`docs/product/database-personas.md`](docs/product/database-personas.md) for the database roles, jobs-to-be-done, capability mapping and persona-oriented workspace model that shapes the application UX.

See [`docs/architecture/connection-profiles.md`](docs/architecture/connection-profiles.md) for the connection-profile and credential security boundary.

See [`docs/architecture/query-execution.md`](docs/architecture/query-execution.md) for the editor, execution, cancellation, history and export boundary.

See [`docs/architecture/query-language-intelligence.md`](docs/architecture/query-language-intelligence.md) for the M5 parser, diagnostics and live-catalogue completion architecture.

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
pnpm --filter @nublox/sql-workbench-desktop build
pnpm --filter @nublox/sql-workbench-desktop start
```

The MySQL provider consumes the published NuBloxSQL package, while the metaobject bridge consumes the published Metaobject package. SQL Workbench keeps both package boundaries explicit so each repository can evolve independently.

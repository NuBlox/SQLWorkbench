# Database Explorer Architecture

## Purpose

M2 introduces a database-neutral object explorer that can progressively discover a live database without forcing every provider to materialize its complete catalogue for the first tree render.

The explorer remains above the provider boundary:

```text
Svelte renderer
      |
 typed preload API
      |
 Electron IPC
      |
DesktopServices
      |
DatabaseExplorerService
      |
   QueryService
      |
DatabaseProvider.introspect(...)
      |
provider-specific catalogue discovery
```

The renderer never imports a database driver and the core explorer never branches on provider id.

## Introspection depth

`IntrospectionOptions.depth` defines three provider-neutral discovery levels:

- `namespaces` — server identity and database/schema namespaces only;
- `relations` — namespaces plus tables and views, without relation internals;
- `full` — complete normalized catalogue data supported by the provider.

`full` remains the default so existing provider callers retain their previous behaviour.

The MySQL provider now avoids the expensive column, index and foreign-key INFORMATION_SCHEMA queries until `full` detail is requested. Namespace discovery does not query tables, and relation discovery does not query columns, indexes or foreign keys.

## Explorer service

`DatabaseExplorerService` provides three progressively scoped operations:

1. `listNamespaces` loads the database/schema level;
2. `listRelations` loads tables and views for a selected namespace;
3. `describeRelation` loads columns, indexes and foreign keys for a selected table or view.

Each operation verifies that the active provider advertises `catalogIntrospection` before requesting metadata.

The service returns normalized explorer view models rather than provider-specific INFORMATION_SCHEMA rows. This keeps the desktop contract suitable for PostgreSQL, SQLite, SQL Server and Oracle providers as they are added.

## Desktop trust boundary

The explorer is exposed to the sandboxed renderer through three typed IPC calls:

- `explorer.namespaces(request)`;
- `explorer.relations(request)`;
- `explorer.describe(request)`.

The preload bridge exposes only these narrow operations. Database sessions, provider instances and credentials remain in the Electron main process.

## Next slice

The next M2 slice consumes this API in the Svelte Database Explorer workspace with expandable namespace and relation nodes, relation detail panels, refresh/invalidation controls and object search.

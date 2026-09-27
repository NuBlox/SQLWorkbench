# Database Explorer Architecture

## Purpose

M2 provides a database-neutral, progressively loaded object explorer for live database sessions. The renderer does not import a database driver, receive provider instances, or receive credentials.

```text
Svelte Database Explorer
        |
   typed preload API
        |
     Electron IPC
        |
   DesktopServices
        |
DatabaseExplorerService
        |
  provider explorer adapter ---- fallback ---- DatabaseProvider.introspect(depth)
        |
provider-specific metadata queries
```

## Progressive loading

The original progressive contract remains available through `IntrospectionOptions.depth`:

- `namespaces` — server identity plus database/schema namespaces;
- `relations` — namespaces plus tables/views without relation internals;
- `full` — complete normalized catalogue data supported by the provider.

`full` remains the compatibility default.

For providers that implement the optional `DatabaseExplorerProvider`, `DatabaseExplorerService` prefers fine-grained metadata operations. This avoids hydrating a complete catalogue merely to expand one tree node. Providers that have not adopted the fine-grained adapter continue to work through the progressive introspection fallback.

## Fine-grained provider contract

`DatabaseExplorerProvider` exposes:

- `listNamespaces`;
- `listObjects` for tables/views in one namespace;
- `describeTable` for columns, indexes and foreign keys of one relation;
- `listRoutines` for procedures/functions;
- `listTriggers`;
- `listEvents`;
- `listPrincipals`;
- `listRoleGrants`;
- `listPrivileges`;
- `search`.

The normalized catalogue package owns the cross-provider metadata models. Provider-specific INFORMATION_SCHEMA rows do not escape the provider package.

## MySQL implementation

The MySQL provider uses INFORMATION_SCHEMA and parameterized metadata queries. Namespace expansion is catalog-scoped, relation detail is table-scoped, and procedures/functions, triggers and scheduled events are loaded only when their categories are requested.

Visible security metadata is derived from INFORMATION_SCHEMA privilege tables and `APPLICABLE_ROLES`. It is intentionally observational: the identity sees only metadata MySQL permits it to see. M2 does not grant, revoke, create or alter users/roles; administrative mutation belongs to M6.

Object search is executed in MySQL across tables/views, routines, triggers and events and returns normalized object-search results. Search results are bounded by the core request limit.

## Desktop trust boundary

The sandboxed renderer receives narrow typed calls:

- `explorer.namespaces(request)`;
- `explorer.relations(request)`;
- `explorer.describe(request)`;
- `explorer.routines(request)`;
- `explorer.triggers(request)`;
- `explorer.events(request)`;
- `explorer.principals(connectionId)`;
- `explorer.roles(connectionId)`;
- `explorer.privileges(request)`;
- `explorer.search(request)`.

Database sessions, drivers, provider adapters, filesystem access and credentials remain in the Electron main process.

## Renderer model

The M2 workspace is deliberately lazy:

1. selecting a connection loads namespaces;
2. expanding a namespace loads tables/views for that namespace;
3. opening a relation loads only that relation's columns/indexes/foreign keys;
4. routines, triggers and events are separate on-demand groups;
5. security metadata is loaded only when the security section is opened;
6. search runs against the provider rather than filtering a fully hydrated client catalogue.

Refresh invalidates renderer caches and reloads namespaces. Connection changes also invalidate explorer state so metadata from one database identity cannot bleed into another session.

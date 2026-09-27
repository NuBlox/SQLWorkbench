# Query Language Intelligence

## Decision

NuBlox SQL Workbench owns a provider-aware query-language abstraction in `@nublox/workbench-query-engineering` rather than binding Monaco directly to a parser library.

The first implementation uses `dt-sql-parser@4.5.1` for MySQL syntax parsing, editor-oriented diagnostics and grammar completion. The Workbench-facing interfaces remain NuBlox-owned so parser technology can evolve independently from the desktop renderer.

## Responsibilities

`@nublox/workbench-query-engineering` owns:

- provider-to-dialect resolution;
- SQL syntax validation and positioned diagnostics;
- statement boundary discovery;
- SQL entity discovery;
- normalized completion items;
- composition of grammar completion with live database catalogue metadata.

It does **not** own:

- database connections;
- catalogue acquisition;
- query execution;
- schema mutation;
- Monaco APIs.

## Live catalogue flow

```text
Database Provider
      |
      v
QueryService.introspect(depth = full)
      |
      v
DesktopQueryLanguageService
      |
      v
QueryCompletionCatalog
      |
      v
Typed preload IPC
      |
      v
SqlWorkspace
      |
      v
SqlEditor + QueryLanguageService
      |
      +--> syntax diagnostics
      +--> grammar keywords
      +--> live tables / views / columns
```

The catalogue snapshot is provider-neutral. The editor refreshes it when the active connection changes, can refresh it manually, and refreshes it after successful schema-changing SQL.

## Renderer model

Parsing and completion execute in the renderer for low editor latency. The parser receives SQL text and cursor position only; database credentials never cross the preload boundary.

Monaco completion providers are scoped to the owning editor model so other SQL editors do not inherit the wrong connection catalogue.

Parser diagnostics are debounced before being written to Monaco model markers.

## Initial completion behaviour

The MySQL language service combines:

1. parser-provided SQL keyword candidates;
2. grammar context indicating relation, column or namespace positions;
3. live catalogue tables and views;
4. live columns narrowed to relations referenced in the active statement;
5. qualified-column completion such as `orders.`.

## Future dialects

Additional providers should register a dialect implementation behind the same `QueryLanguageService` contract. PostgreSQL, SQLite, SQL Server and Oracle support must not introduce provider-specific conditionals into Monaco or the desktop workspace.

## Next M5 increments

- semantic lint rules using live metadata;
- SQL formatting;
- visual query builder backed by a stable normalized query model;
- explain-plan visualization;
- query statistics and plan history.

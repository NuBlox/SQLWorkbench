# Query Language Intelligence

## Decision

NuBlox SQL Workbench owns a provider-aware query-language abstraction in `@nublox/workbench-query-engineering` rather than binding Monaco directly to parser or formatter libraries.

The first implementation uses `sqllens@1.11.0` for MySQL syntax parsing, error-tolerant editor diagnostics, statement boundaries, scope-aware grammar completion and schema-fed semantic analysis. SQL formatting is provided through `sql-formatter@15.9.0`. The Workbench-facing interfaces remain NuBlox-owned so language-engine and formatter technology can evolve independently from the desktop renderer.

An earlier branch implementation evaluated `dt-sql-parser@4.5.1`. Its published ESM entry was accepted by the renderer bundler but failed direct Node.js 22 execution because the package imports a directory subpath that the Node ESM resolver rejects. NuBlox does not carry a loader workaround for a foundational language service; the branch moved to a package that passes both browser bundling and direct Node test execution.

## Responsibilities

`@nublox/workbench-query-engineering` owns:

- provider-to-dialect resolution;
- SQL syntax validation and positioned diagnostics;
- live-catalogue semantic diagnostics for unknown or ambiguous relations and columns;
- statement boundary discovery;
- SQL entity discovery;
- normalized completion items;
- composition of grammar completion with live database catalogue metadata;
- dialect-aware SQL formatting.

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
      +--> semantic catalogue diagnostics
      +--> grammar keywords / functions / CTEs
      +--> live tables / views / columns
      +--> document formatting
```

The catalogue snapshot is provider-neutral. The MySQL adapter converts that snapshot to the language engine's schema mapping only inside the query-engineering package. The editor refreshes the snapshot when the active connection changes, can refresh it manually, and refreshes it after successful schema-changing SQL.

## Renderer model

Parsing, semantic analysis, completion and formatting execute in the renderer for low editor latency. The language engine receives SQL text, cursor position and non-secret catalogue metadata only; database credentials never cross the preload boundary.

Monaco completion and formatting providers are scoped to the owning editor model so other SQL editors do not inherit the wrong connection catalogue or formatter instance.

Diagnostics are debounced before being written to Monaco model markers. Syntax errors are reported as errors. Catalogue and semantic findings are reported as warnings so incomplete metadata, temporary objects or session-local constructs do not block query execution.

Semantic analysis is suppressed while syntax errors exist to avoid cascading warnings from structurally incomplete SQL.

## Completion behaviour

The MySQL language service combines:

1. grammar-derived SQL keyword and function candidates;
2. scope-aware relation, CTE, namespace and column positions;
3. live catalogue tables and views;
4. live columns supplied through the schema mapping;
5. qualified-column completion such as `orders.`.

NuBlox retains its own normalized completion contract and reclassifies live relation candidates as tables or views for the desktop UI.

## Formatting behaviour

The MySQL formatter uses two-space indentation and upper-case SQL keywords. Formatting is exposed through Monaco's document-formatting contract and the standard format-document command. Invalid or incomplete text is left unchanged rather than damaging the user's buffer.

## Future dialects

Additional providers register a dialect implementation behind the same `QueryLanguageService` contract. `sqllens` currently provides native parser paths that align with planned PostgreSQL, SQLite and T-SQL/SQL Server expansion as well as MySQL/MariaDB. `sql-formatter` also supports those dialects and Oracle PL/SQL. Oracle parsing is not provided by the current language engine and will require a separate NuBlox dialect adapter or an additional compatible engine behind the same contract.

Provider expansion must not introduce provider-specific conditionals into Monaco or the desktop workspace.

## Next M5 increments

- visual query builder backed by a stable normalized query model;
- explain-plan visualization;
- query statistics and plan history.

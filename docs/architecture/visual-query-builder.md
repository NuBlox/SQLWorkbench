# Visual Query Builder

## Decision

The visual query builder is a structured query authoring surface over live database metadata. The Svelte UI never concatenates SQL directly.

```text
Live catalogue
    |
    v
QueryCompletionCatalog
    |
    v
VisualQueryBuilder UI
    |
    v
VisualQueryModel
    |
    +--> validateVisualQuery
    |
    +--> renderVisualQuery
             |
             v
        generated SQL
             |
             v
          Monaco
             |
             +--> parser / semantic diagnostics
             +--> formatting
             +--> execution / explain
```

The model and SQL generator live in `@nublox/workbench-query-engineering/visual-query`, not in the renderer.

## Model

A visual query consists of:

- one optional base source (`FROM`);
- selected projections;
- aggregate functions and aliases;
- typed joins;
- filters with AND/OR conjunctions;
- `GROUP BY` columns;
- `ORDER BY` columns and direction;
- `DISTINCT`;
- a positive integer row limit.

Sources retain their physical catalog/schema/name plus a Workbench-local source id and optional SQL alias. Column references point to source ids, which prevents ambiguous UI references when the same physical relation appears more than once.

## Catalogue validation

When a live `QueryCompletionCatalog` is supplied, validation checks:

- every source exists in the live catalogue;
- source ids are unique;
- visible source aliases/names are unambiguous;
- referenced columns exist on their selected source;
- non-cross joins include both join columns and reference their joined source;
- filters that require values have one;
- `LIMIT` is a positive integer.

The same live catalogue therefore drives IntelliSense, semantic diagnostics and the visual query builder.

## SQL generation

The initial generator targets MySQL because MySQL is the first production provider. It:

- backtick-quotes identifiers and escapes embedded backticks;
- single-quotes text literals and escapes embedded apostrophes;
- renders numeric and boolean literals without string interpolation;
- renders column-to-column predicates structurally;
- supports INNER, LEFT, RIGHT and CROSS joins;
- supports COUNT, SUM, AVG, MIN and MAX projections;
- supports `IS NULL` / `IS NOT NULL` without values.

Generated SQL is returned to Monaco rather than executed directly. This keeps one execution path and ensures the same parser, semantic diagnostics, formatter, history and explain-plan features apply to visually generated SQL.

## UI behaviour

The builder is available as an SQL workspace output tab and toolbar action. Users choose live tables/views and columns from metadata, see generated SQL immediately, then use **Apply to editor** to replace the editor buffer.

The draft resets when the live catalogue snapshot changes so stale table/column selections cannot silently survive a schema or connection change.

## Future dialects

The `VisualQueryModel` is intentionally provider-neutral. Provider-specific SQL rendering should be added behind the query-engineering package rather than introducing dialect conditionals into Svelte.

As PostgreSQL, SQLite, SQL Server and Oracle providers are added, the visual model should remain stable while renderers handle identifier quoting, row limiting and provider-specific syntax.

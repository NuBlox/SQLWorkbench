# Explain Plan Visualization

## Decision

Explain plans remain provider-owned at acquisition time and become provider-neutral at the query-engineering boundary.

```text
SQL editor
   |
   v
DesktopApi.queries.explain
   |
   v
QueryService.explain
   |
   v
DatabaseProvider.explain
   |
   | raw provider plan + format id
   v
@nublox/workbench-query-engineering/explain-plan
   |
   | normalized QueryPlanView
   v
QueryPlanViewer
```

The desktop renderer never parses MySQL optimizer JSON directly. It receives a stable NuBlox plan tree whose nodes expose common concepts such as operator kind, label, estimated rows, cost, filtering, access type, chosen key and provider properties.

## MySQL

The current MySQL provider uses `EXPLAIN FORMAT=JSON`. Its existing provider contract returns:

- `format: "mysql-json"`;
- the raw provider result as `raw`.

The query-engineering normalizer extracts the JSON payload and maps common MySQL structures including:

- query blocks;
- nested loops;
- table access;
- ordering and grouping operations;
- duplicate removal;
- materialized subqueries;
- unions;
- windowing;
- row estimates and filter percentages;
- optimizer cost information;
- selected indexes/keys.

Unknown provider properties are retained as display properties where they are scalar. Structural objects that look like optimizer nodes remain visible as children rather than being silently discarded.

## Desktop boundary

`DesktopExplainService` validates that the selected provider advertises `explainPlan`, invokes the core `QueryService`, and normalizes the provider response. Only the normalized plan crosses the preload IPC boundary.

The plan viewer is interactive but read-only. Selecting an operator shows its detailed optimizer properties. The viewer is independent from the MySQL raw schema.

## Safety and execution semantics

Explain runs the current editor statement and does not execute the statement through the normal result path. Provider implementations are responsible for their database's explain semantics.

Explain operations are not added to normal query history because they are analysis operations rather than user query executions. Plan-history persistence is a separate M5 capability.

## Future providers

Each additional provider should either:

1. emit a format already understood by query-engineering; or
2. add a format normalizer behind `normalizeExplainPlan`.

Renderer code must not branch on provider IDs or provider-specific JSON shapes.

## Next increment

Query statistics and plan history should persist normalized plan snapshots plus query identity and timing, enabling plan comparison without retaining provider credentials or session objects.

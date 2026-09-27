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
QueryPlanHistoryStore + QueryStatisticsService
   |
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

`DesktopExplainService` validates that the selected provider advertises `explainPlan`, invokes the core `QueryService`, normalizes the provider response and persists the normalized snapshot. Only normalized plan and statistics data cross the preload IPC boundary.

The plan viewer is interactive but read-only. Selecting an operator shows its detailed optimizer properties. The viewer is independent from the MySQL raw schema.

## Plan history

Explain operations are stored separately from normal execution history in `query-plan-history.json` under the Electron application data directory. Each bounded history entry contains:

- connection/profile identifier;
- original SQL;
- SHA-256 query fingerprint;
- capture timestamp;
- explain latency;
- normalized provider-neutral plan tree.

No credentials, database session objects or raw provider plan blobs are persisted. Writes use the same atomic temporary-file/rename pattern as query history, with restrictive file permissions where the platform honours them.

Query identity is deliberately conservative. Leading/trailing whitespace and terminal semicolons are ignored, but internal whitespace is preserved so string literals with different whitespace cannot collide merely because of normalization.

## Query statistics

`QueryStatisticsService` joins bounded execution history with normalized plan history using connection id plus query fingerprint. The current statistics contract provides:

- execution count;
- successful, failed and cancelled counts;
- average, minimum and maximum runtime;
- latest execution time;
- explain snapshot count;
- latest explain duration and node count;
- latest and previous optimizer cost;
- plan-cost delta.

The current explain response includes these statistics, so the plan viewer can show historical context alongside the current optimizer tree. A positive plan-cost delta is surfaced as a potential regression indicator; a negative delta is surfaced as an improvement indicator. It remains an optimizer estimate rather than a measured runtime conclusion.

## Safety and execution semantics

Explain runs the current editor statement and does not execute the statement through the normal result path. Provider implementations are responsible for their database's explain semantics.

Explain operations are not added to normal query history because they are analysis operations rather than user query executions. Plan-history persistence has an independent API and lifecycle.

## Future providers

Each additional provider should either:

1. emit a format already understood by query-engineering; or
2. add a format normalizer behind `normalizeExplainPlan`.

Renderer code must not branch on provider IDs or provider-specific JSON shapes. Query statistics continue to operate on normalized plan metadata regardless of the provider that produced it.

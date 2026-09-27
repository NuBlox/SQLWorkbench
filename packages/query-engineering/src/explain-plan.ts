export interface QueryPlanProperty {
  readonly key: string;
  readonly label: string;
  readonly value: string;
}

export interface QueryPlanNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly subtitle?: string;
  readonly estimatedRows?: number;
  readonly estimatedCost?: number;
  readonly filteredPercent?: number;
  readonly accessType?: string;
  readonly keyUsed?: string;
  readonly properties: readonly QueryPlanProperty[];
  readonly children: readonly QueryPlanNode[];
}

export interface QueryPlanView {
  readonly providerId: string;
  readonly format: string;
  readonly root: QueryPlanNode;
  readonly nodeCount: number;
  readonly queryCost?: number;
}

const STRUCTURAL_KEYS = new Set([
  "query_block",
  "nested_loop",
  "table",
  "grouping_operation",
  "ordering_operation",
  "duplicates_removal",
  "buffer_result",
  "windowing",
  "materialized_from_subquery",
  "attached_subqueries",
  "subqueries",
  "union_result",
  "query_specifications",
  "hash_join",
]);

export function normalizeExplainPlan(providerId: string, format: string, raw: unknown): QueryPlanView {
  if (format !== "mysql-json") {
    throw new Error(`Explain plan format '${format}' is not supported by the current visualizer.`);
  }
  const payload = extractJsonPayload(raw);
  const rootRecord = asRecord(payload);
  if (!rootRecord) throw new Error("MySQL explain plan payload is not an object.");

  const queryBlock = asRecord(rootRecord.query_block);
  const root = queryBlock
    ? normalizeNode(queryBlock, "query_block", "root.query_block")
    : normalizeNode(rootRecord, "query_plan", "root");
  const queryCost = queryBlock ? numberFromRecord(asRecord(queryBlock.cost_info), "query_cost") : undefined;
  return {
    providerId,
    format,
    root,
    nodeCount: countNodes(root),
    ...(queryCost !== undefined ? { queryCost } : {}),
  };
}

function normalizeNode(record: Record<string, unknown>, hint: string, path: string): QueryPlanNode {
  const children: QueryPlanNode[] = [];
  const properties: QueryPlanProperty[] = [];

  for (const [key, value] of Object.entries(record)) {
    if (key === "cost_info") continue;
    if (isScalar(value)) {
      if (!PRIMARY_FIELDS.has(key)) properties.push(property(key, value));
      continue;
    }
    if (value === null || value === undefined) continue;

    if (Array.isArray(value)) {
      const records = value.filter(isRecord);
      if (records.length === 0) continue;
      if (STRUCTURAL_KEYS.has(key) || records.some(looksLikePlanObject)) {
        if (key === "nested_loop") {
          children.push(normalizeArrayNode(records, key, `${path}.${key}`));
        } else {
          records.forEach((child, index) => children.push(normalizeNode(child, key, `${path}.${key}[${index}]`)));
        }
      }
      continue;
    }

    const child = asRecord(value);
    if (!child) continue;
    if (STRUCTURAL_KEYS.has(key) || looksLikePlanObject(child)) {
      children.push(normalizeNode(child, key, `${path}.${key}`));
    }
  }

  const costInfo = asRecord(record.cost_info);
  if (costInfo) {
    for (const [key, value] of Object.entries(costInfo)) {
      if (isScalar(value)) properties.push(property(`cost.${key}`, value));
    }
  }

  const estimatedRows = firstNumber(record.rows_produced_per_join, record.rows_examined_per_scan, record.rows);
  const estimatedCost = firstNumber(costInfo?.prefix_cost, costInfo?.query_cost, costInfo?.read_cost);
  const filteredPercent = firstNumber(record.filtered);
  const accessType = stringValue(record.access_type);
  const keyUsed = stringValue(record.key);
  const label = nodeLabel(record, hint);
  const subtitle = nodeSubtitle(record, hint);

  return {
    id: stableId(path),
    kind: planKind(hint),
    label,
    ...(subtitle ? { subtitle } : {}),
    ...(estimatedRows !== undefined ? { estimatedRows } : {}),
    ...(estimatedCost !== undefined ? { estimatedCost } : {}),
    ...(filteredPercent !== undefined ? { filteredPercent } : {}),
    ...(accessType ? { accessType } : {}),
    ...(keyUsed ? { keyUsed } : {}),
    properties,
    children,
  };
}

function normalizeArrayNode(records: readonly Record<string, unknown>[], hint: string, path: string): QueryPlanNode {
  const children = records.map((record, index) => {
    const entries = Object.entries(record);
    if (entries.length === 1) {
      const [key, value] = entries[0]!;
      const child = asRecord(value);
      if (child) return normalizeNode(child, key, `${path}[${index}].${key}`);
    }
    return normalizeNode(record, "operation", `${path}[${index}]`);
  });
  return {
    id: stableId(path),
    kind: planKind(hint),
    label: humanize(hint),
    properties: [],
    children,
  };
}

const PRIMARY_FIELDS = new Set([
  "select_id",
  "table_name",
  "access_type",
  "key",
  "rows_examined_per_scan",
  "rows_produced_per_join",
  "rows",
  "filtered",
  "using_filesort",
  "using_temporary_table",
]);

function nodeLabel(record: Record<string, unknown>, hint: string): string {
  if (hint === "table") return stringValue(record.table_name) ?? "Table access";
  if (hint === "query_block") {
    const selectId = stringValue(record.select_id);
    return selectId ? `Query block #${selectId}` : "Query block";
  }
  if (hint === "union_result") return stringValue(record.table_name) ?? "Union result";
  if (hint === "materialized_from_subquery") return "Materialized subquery";
  return humanize(hint);
}

function nodeSubtitle(record: Record<string, unknown>, hint: string): string | undefined {
  if (hint === "table") {
    const access = stringValue(record.access_type);
    const key = stringValue(record.key);
    if (access && key) return `${access} access using ${key}`;
    if (access) return `${access} access`;
    if (key) return `Index ${key}`;
  }
  if (Boolean(record.using_filesort)) return "Using filesort";
  if (Boolean(record.using_temporary_table)) return "Using temporary table";
  return undefined;
}

function planKind(hint: string): string {
  switch (hint) {
    case "query_block": return "query";
    case "table": return "table";
    case "nested_loop": return "join";
    case "ordering_operation": return "sort";
    case "grouping_operation": return "group";
    case "duplicates_removal": return "deduplicate";
    case "materialized_from_subquery": return "materialize";
    case "union_result": return "union";
    case "windowing": return "window";
    default: return hint.replaceAll("_", "-");
  }
}

function extractJsonPayload(raw: unknown): unknown {
  if (typeof raw === "string") return parseJsonString(raw);
  if (Array.isArray(raw)) {
    for (const value of raw) {
      try { return extractJsonPayload(value); } catch { /* keep searching */ }
    }
    throw new Error("MySQL explain plan did not contain a JSON payload.");
  }
  const record = asRecord(raw);
  if (!record) throw new Error("MySQL explain plan did not contain a JSON payload.");
  if (asRecord(record.query_block)) return record;

  for (const preferred of ["EXPLAIN", "explain", "JSON", "json"]) {
    if (!(preferred in record)) continue;
    try { return extractJsonPayload(record[preferred]); } catch { /* keep searching */ }
  }
  for (const value of Object.values(record)) {
    if (typeof value !== "string" && !Array.isArray(value) && !asRecord(value)) continue;
    try { return extractJsonPayload(value); } catch { /* keep searching */ }
  }
  throw new Error("MySQL explain plan did not contain a JSON payload.");
}

function parseJsonString(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) throw new Error("Value is not JSON.");
  return JSON.parse(trimmed) as unknown;
}

function looksLikePlanObject(record: Record<string, unknown>): boolean {
  return Object.keys(record).some((key) => STRUCTURAL_KEYS.has(key) || PRIMARY_FIELDS.has(key) || key === "cost_info");
}

function countNodes(node: QueryPlanNode): number {
  return 1 + node.children.reduce((count, child) => count + countNodes(child), 0);
}

function property(key: string, value: string | number | boolean): QueryPlanProperty {
  return { key, label: humanize(key.replace(/^cost\./u, "")), value: String(value) };
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function stableId(path: string): string {
  let hash = 2166136261;
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `plan-${(hash >>> 0).toString(36)}`;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return asRecord(value) !== undefined;
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function stringValue(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return String(value);
}

function firstNumber(...values: readonly unknown[]): number | undefined {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function numberFromRecord(record: Record<string, unknown> | undefined, key: string): number | undefined {
  return record ? firstNumber(record[key]) : undefined;
}

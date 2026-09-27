import type { QueryCompletionCatalog, QueryCatalogRelation } from "./index.js";

export type VisualQueryJoinType = "inner" | "left" | "right" | "cross";
export type VisualQueryAggregate = "none" | "count" | "sum" | "avg" | "min" | "max";
export type VisualQueryFilterOperator =
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "like"
  | "not-like"
  | "is-null"
  | "is-not-null";
export type VisualQueryConjunction = "and" | "or";
export type VisualQueryOrderDirection = "asc" | "desc";
export type VisualQueryValue =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "number"; readonly value: number }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "column"; readonly sourceId: string; readonly column: string };

export interface VisualQuerySource {
  readonly id: string;
  readonly catalog?: string;
  readonly schema?: string;
  readonly name: string;
  readonly alias?: string;
}

export interface VisualQueryColumnRef {
  readonly sourceId: string;
  readonly column: string;
}

export interface VisualQueryProjection extends VisualQueryColumnRef {
  readonly id: string;
  readonly aggregate?: VisualQueryAggregate;
  readonly alias?: string;
}

export interface VisualQueryJoin {
  readonly id: string;
  readonly type: VisualQueryJoinType;
  readonly source: VisualQuerySource;
  readonly left?: VisualQueryColumnRef;
  readonly right?: VisualQueryColumnRef;
}

export interface VisualQueryFilter extends VisualQueryColumnRef {
  readonly id: string;
  readonly conjunction: VisualQueryConjunction;
  readonly operator: VisualQueryFilterOperator;
  readonly value?: VisualQueryValue;
}

export interface VisualQueryGroupBy extends VisualQueryColumnRef {
  readonly id: string;
}

export interface VisualQueryOrderBy extends VisualQueryColumnRef {
  readonly id: string;
  readonly direction: VisualQueryOrderDirection;
}

export interface VisualQueryModel {
  readonly distinct: boolean;
  readonly from?: VisualQuerySource;
  readonly projections: readonly VisualQueryProjection[];
  readonly joins: readonly VisualQueryJoin[];
  readonly filters: readonly VisualQueryFilter[];
  readonly groupBy: readonly VisualQueryGroupBy[];
  readonly orderBy: readonly VisualQueryOrderBy[];
  readonly limit?: number;
}

export interface VisualQueryValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface VisualQueryRelationOption {
  readonly key: string;
  readonly namespaceLabel: string;
  readonly catalog?: string;
  readonly schema?: string;
  readonly name: string;
  readonly kind: "table" | "view";
  readonly columns: readonly string[];
}

export function emptyVisualQuery(): VisualQueryModel {
  return {
    distinct: false,
    projections: [],
    joins: [],
    filters: [],
    groupBy: [],
    orderBy: [],
  };
}

export function visualQueryRelations(catalog?: QueryCompletionCatalog): readonly VisualQueryRelationOption[] {
  if (!catalog) return [];
  return catalog.namespaces.flatMap((namespace) => namespace.relations.map((relation) => ({
    key: relationKey(namespace.catalog, namespace.schema, relation.name),
    namespaceLabel: namespace.label,
    ...(namespace.catalog ? { catalog: namespace.catalog } : {}),
    ...(namespace.schema ? { schema: namespace.schema } : {}),
    name: relation.name,
    kind: relation.kind,
    columns: relation.columns.map((column) => column.name),
  }))).sort((left, right) => `${left.namespaceLabel}.${left.name}`.localeCompare(`${right.namespaceLabel}.${right.name}`));
}

export function visualSourceFromRelation(id: string, relation: VisualQueryRelationOption, alias?: string): VisualQuerySource {
  return {
    id: requireIdentifier(id, "Source id"),
    ...(relation.catalog ? { catalog: relation.catalog } : {}),
    ...(relation.schema ? { schema: relation.schema } : {}),
    name: relation.name,
    ...(alias?.trim() ? { alias: alias.trim() } : {}),
  };
}

export function validateVisualQuery(model: VisualQueryModel, catalog?: QueryCompletionCatalog): VisualQueryValidation {
  const errors: string[] = [];
  if (!model.from) return { valid: false, errors: ["Choose a source table or view."] };

  const sources = allSources(model);
  const sourceIds = new Set<string>();
  const aliases = new Set<string>();
  for (const source of sources) {
    if (!source.id.trim()) errors.push("Every source requires an id.");
    if (sourceIds.has(source.id)) errors.push(`Source id '${source.id}' is duplicated.`);
    sourceIds.add(source.id);
    const visible = (source.alias?.trim() || source.name).toLowerCase();
    if (aliases.has(visible)) errors.push(`Source alias/name '${visible}' is ambiguous.`);
    aliases.add(visible);
    if (!source.name.trim()) errors.push(`Source '${source.id}' does not have a relation name.`);
    if (catalog && !findCatalogRelation(catalog, source)) {
      errors.push(`Relation '${qualifiedSourceName(source)}' is not present in the live catalogue.`);
    }
  }

  for (const projection of model.projections) validateColumnRef(projection, "Projection", sources, catalog, errors);
  for (const group of model.groupBy) validateColumnRef(group, "GROUP BY", sources, catalog, errors);
  for (const order of model.orderBy) validateColumnRef(order, "ORDER BY", sources, catalog, errors);
  for (const filter of model.filters) {
    validateColumnRef(filter, "Filter", sources, catalog, errors);
    if (requiresFilterValue(filter.operator) && filter.value === undefined) {
      errors.push(`Filter on '${filter.column}' requires a value.`);
    }
    if (filter.value?.kind === "column") validateColumnRef(filter.value, "Filter value", sources, catalog, errors);
  }

  for (const join of model.joins) {
    if (join.type === "cross") continue;
    if (!join.left || !join.right) {
      errors.push(`Join '${join.id}' requires both join columns.`);
      continue;
    }
    validateColumnRef(join.left, "Join", sources, catalog, errors);
    validateColumnRef(join.right, "Join", sources, catalog, errors);
    if (join.left.sourceId !== join.source.id && join.right.sourceId !== join.source.id) {
      errors.push(`Join '${join.id}' must reference its joined source '${join.source.id}'.`);
    }
  }

  if (model.limit !== undefined && (!Number.isInteger(model.limit) || model.limit <= 0)) {
    errors.push("LIMIT must be a positive integer.");
  }

  return { valid: errors.length === 0, errors };
}

export function renderVisualQuery(model: VisualQueryModel, catalog?: QueryCompletionCatalog): string {
  const validation = validateVisualQuery(model, catalog);
  if (!validation.valid) throw new Error(validation.errors.join(" "));
  const from = model.from!;
  const sources = new Map(allSources(model).map((source) => [source.id, source]));
  const lines: string[] = [];

  const projections = model.projections.length > 0
    ? model.projections.map((projection) => renderProjection(projection, sources)).join(",\n  ")
    : "*";
  lines.push(`SELECT${model.distinct ? " DISTINCT" : ""}\n  ${projections}`);
  lines.push(`FROM ${renderSource(from)}`);

  for (const join of model.joins) {
    const keyword = joinKeyword(join.type);
    if (join.type === "cross") {
      lines.push(`${keyword} ${renderSource(join.source)}`);
    } else {
      lines.push(`${keyword} ${renderSource(join.source)}\n  ON ${renderColumn(join.left!, sources)} = ${renderColumn(join.right!, sources)}`);
    }
  }

  if (model.filters.length > 0) {
    const clauses = model.filters.map((filter, index) => {
      const prefix = index === 0 ? "WHERE" : filter.conjunction.toUpperCase();
      return `${prefix} ${renderFilter(filter, sources)}`;
    });
    lines.push(clauses.join("\n"));
  }

  if (model.groupBy.length > 0) {
    lines.push(`GROUP BY\n  ${model.groupBy.map((group) => renderColumn(group, sources)).join(",\n  ")}`);
  }

  if (model.orderBy.length > 0) {
    lines.push(`ORDER BY\n  ${model.orderBy.map((order) => `${renderColumn(order, sources)} ${order.direction.toUpperCase()}`).join(",\n  ")}`);
  }

  if (model.limit !== undefined) lines.push(`LIMIT ${model.limit}`);
  return `${lines.join("\n")} ;`.replace(" ;", ";");
}

function renderProjection(projection: VisualQueryProjection, sources: ReadonlyMap<string, VisualQuerySource>): string {
  const column = renderColumn(projection, sources);
  const aggregate = projection.aggregate ?? "none";
  const expression = aggregate === "none" ? column : `${aggregate.toUpperCase()}(${column})`;
  return projection.alias?.trim() ? `${expression} AS ${quoteIdentifier(projection.alias)}` : expression;
}

function renderFilter(filter: VisualQueryFilter, sources: ReadonlyMap<string, VisualQuerySource>): string {
  const column = renderColumn(filter, sources);
  switch (filter.operator) {
    case "is-null": return `${column} IS NULL`;
    case "is-not-null": return `${column} IS NOT NULL`;
    case "like": return `${column} LIKE ${renderValue(filter.value!, sources)}`;
    case "not-like": return `${column} NOT LIKE ${renderValue(filter.value!, sources)}`;
    default: return `${column} ${filter.operator} ${renderValue(filter.value!, sources)}`;
  }
}

function renderValue(value: VisualQueryValue, sources: ReadonlyMap<string, VisualQuerySource>): string {
  switch (value.kind) {
    case "text": return `'${value.value.replaceAll("'", "''")}'`;
    case "number": {
      if (!Number.isFinite(value.value)) throw new Error("Filter numeric value must be finite.");
      return String(value.value);
    }
    case "boolean": return value.value ? "TRUE" : "FALSE";
    case "column": return renderColumn(value, sources);
  }
}

function renderColumn(reference: VisualQueryColumnRef, sources: ReadonlyMap<string, VisualQuerySource>): string {
  const source = sources.get(reference.sourceId);
  if (!source) throw new Error(`Source '${reference.sourceId}' does not exist.`);
  const qualifier = source.alias?.trim() || source.name;
  if (reference.column === "*") return `${quoteIdentifier(qualifier)}.*`;
  return `${quoteIdentifier(qualifier)}.${quoteIdentifier(reference.column)}`;
}

function renderSource(source: VisualQuerySource): string {
  const namespace = source.catalog ?? source.schema;
  const relation = namespace
    ? `${quoteIdentifier(namespace)}.${quoteIdentifier(source.name)}`
    : quoteIdentifier(source.name);
  return source.alias?.trim() ? `${relation} AS ${quoteIdentifier(source.alias)}` : relation;
}

function joinKeyword(type: VisualQueryJoinType): string {
  switch (type) {
    case "inner": return "INNER JOIN";
    case "left": return "LEFT JOIN";
    case "right": return "RIGHT JOIN";
    case "cross": return "CROSS JOIN";
  }
}

function validateColumnRef(
  reference: VisualQueryColumnRef,
  label: string,
  sources: readonly VisualQuerySource[],
  catalog: QueryCompletionCatalog | undefined,
  errors: string[],
): void {
  const source = sources.find((candidate) => candidate.id === reference.sourceId);
  if (!source) {
    errors.push(`${label} references unknown source '${reference.sourceId}'.`);
    return;
  }
  if (!reference.column.trim()) {
    errors.push(`${label} on source '${source.id}' does not specify a column.`);
    return;
  }
  if (!catalog || reference.column === "*") return;
  const relation = findCatalogRelation(catalog, source);
  if (relation && !relation.columns.some((column) => column.name.toLowerCase() === reference.column.toLowerCase())) {
    errors.push(`Column '${reference.column}' is not present on '${qualifiedSourceName(source)}'.`);
  }
}

function findCatalogRelation(catalog: QueryCompletionCatalog, source: VisualQuerySource): QueryCatalogRelation | undefined {
  const namespace = source.catalog ?? source.schema;
  for (const item of catalog.namespaces) {
    const itemNamespace = item.catalog ?? item.schema;
    if (namespace && itemNamespace?.toLowerCase() !== namespace.toLowerCase()) continue;
    const relation = item.relations.find((candidate) => candidate.name.toLowerCase() === source.name.toLowerCase());
    if (relation) return relation;
  }
  return undefined;
}

function allSources(model: VisualQueryModel): readonly VisualQuerySource[] {
  return model.from ? [model.from, ...model.joins.map((join) => join.source)] : model.joins.map((join) => join.source);
}

function requiresFilterValue(operator: VisualQueryFilterOperator): boolean {
  return operator !== "is-null" && operator !== "is-not-null";
}

function qualifiedSourceName(source: VisualQuerySource): string {
  return [source.catalog ?? source.schema, source.name].filter(Boolean).join(".");
}

function relationKey(catalog: string | undefined, schema: string | undefined, name: string): string {
  return `${catalog ?? ""}\u001f${schema ?? ""}\u001f${name}`;
}

function quoteIdentifier(value: string): string {
  return `\`${requireIdentifier(value, "Identifier").replaceAll("`", "``")}\``;
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}

import { MySQL } from "dt-sql-parser";

export type SqlDialectId = "mysql";

export interface SqlPosition {
  readonly lineNumber: number;
  readonly column: number;
}

export interface SqlTextRange {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}

export interface SqlDiagnostic extends SqlTextRange {
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly source: "parser" | "catalog";
}

export interface SqlStatement extends SqlTextRange {
  readonly text: string;
}

export type SqlEntityKind = "table" | "view" | "column" | "database" | "schema" | "unknown";

export interface SqlEntityReference {
  readonly kind: SqlEntityKind;
  readonly name: string;
  readonly alias?: string;
  readonly inActiveStatement: boolean;
}

export interface QueryCatalogColumn {
  readonly name: string;
  readonly dataType?: string;
  readonly databaseType?: string;
}

export interface QueryCatalogRelation {
  readonly catalog?: string;
  readonly schema?: string;
  readonly name: string;
  readonly kind: "table" | "view";
  readonly columns: readonly QueryCatalogColumn[];
}

export interface QueryCatalogNamespace {
  readonly catalog?: string;
  readonly schema?: string;
  readonly label: string;
  readonly relations: readonly QueryCatalogRelation[];
}

export interface QueryCompletionCatalog {
  readonly providerId: string;
  readonly capturedAt: string;
  readonly namespaces: readonly QueryCatalogNamespace[];
}

export type SqlCompletionKind = "keyword" | "catalog" | "schema" | "table" | "view" | "column";

export interface SqlCompletionItem {
  readonly label: string;
  readonly insertText: string;
  readonly kind: SqlCompletionKind;
  readonly detail?: string;
  readonly sortText: string;
}

export interface SqlParseResult {
  readonly dialect: SqlDialectId;
  readonly diagnostics: readonly SqlDiagnostic[];
  readonly statements: readonly SqlStatement[];
  readonly entities: readonly SqlEntityReference[];
}

export interface QueryLanguageService {
  readonly dialect: SqlDialectId;
  parse(sql: string, position?: SqlPosition): SqlParseResult;
  complete(sql: string, position: SqlPosition, catalog?: QueryCompletionCatalog): readonly SqlCompletionItem[];
}

export const supportedQueryDialects: readonly SqlDialectId[] = Object.freeze(["mysql"]);

export function createQueryLanguageService(providerId: string): QueryLanguageService {
  const normalized = providerId.trim().toLowerCase();
  if (normalized === "mysql" || normalized === "mariadb") return new MySqlQueryLanguageService();
  throw new Error(`Query language intelligence does not yet support provider '${providerId}'.`);
}

export class MySqlQueryLanguageService implements QueryLanguageService {
  readonly dialect: SqlDialectId = "mysql";
  readonly #parser = new MySQL();

  parse(sql: string, position?: SqlPosition): SqlParseResult {
    const diagnostics = this.#parser.validate(sql).map((error) => ({
      severity: "error" as const,
      source: "parser" as const,
      message: error.message,
      startLineNumber: error.startLine,
      startColumn: error.startColumn,
      endLineNumber: error.endLine,
      endColumn: error.endColumn,
    }));

    const slices = diagnostics.length === 0 ? this.#parser.splitSQLByStatement(sql) ?? [] : [];
    const statements: SqlStatement[] = slices.map((slice) => ({
      text: slice.text,
      startLineNumber: slice.startLine,
      startColumn: slice.startColumn,
      endLineNumber: slice.endLine,
      endColumn: slice.endColumn,
    }));

    return {
      dialect: this.dialect,
      diagnostics,
      statements,
      entities: this.#entities(sql, position),
    };
  }

  complete(sql: string, position: SqlPosition, catalog?: QueryCompletionCatalog): readonly SqlCompletionItem[] {
    const suggestions = this.#parser.getSuggestionAtCaretPosition(sql, position);
    const items: SqlCompletionItem[] = [];
    const seen = new Set<string>();

    for (const keyword of suggestions?.keywords ?? []) {
      appendCompletion(items, seen, {
        label: keyword,
        insertText: keyword,
        kind: "keyword",
        detail: "SQL keyword",
        sortText: `90:${keyword}`,
      });
    }

    if (!catalog || catalog.providerId.trim().toLowerCase() !== "mysql") return items;

    const syntaxContexts = new Set(
      (suggestions?.syntax ?? []).map((item) => String(item.syntaxContextType).toLowerCase()),
    );
    const entities = this.#entities(sql, position).filter((entity) => entity.inActiveStatement);
    const lexicalContext = completionLexicalContext(sql, position);
    const wantsRelations = hasContext(syntaxContexts, ["table", "view"]) || lexicalContext === "relation";
    const wantsColumns = hasContext(syntaxContexts, ["column", "field"]) || lexicalContext === "column";
    const wantsNamespaces = hasContext(syntaxContexts, ["database", "schema", "catalog"]);

    if (wantsNamespaces) appendNamespaces(items, seen, catalog);
    if (wantsRelations) appendRelations(items, seen, catalog);
    if (wantsColumns) appendColumns(items, seen, catalog, entities, currentQualifier(sql, position));

    if (!wantsNamespaces && !wantsRelations && !wantsColumns) {
      appendRelations(items, seen, catalog);
    }

    return items;
  }

  #entities(sql: string, position?: SqlPosition): SqlEntityReference[] {
    const rawEntities = this.#parser.getAllEntities(sql, position) as readonly unknown[];
    const result: SqlEntityReference[] = [];
    for (const value of rawEntities) {
      const record = asRecord(value);
      const text = typeof record?.text === "string" ? record.text : undefined;
      if (!text) continue;
      const belongStmt = asRecord(record?.belongStmt);
      const alias = typeof record?.alias === "string" && record.alias ? record.alias : undefined;
      const type = typeof record?.entityContextType === "string" ? record.entityContextType : "unknown";
      result.push({
        kind: entityKind(type),
        name: unquoteIdentifier(text),
        ...(alias ? { alias: unquoteIdentifier(alias) } : {}),
        inActiveStatement: Boolean(belongStmt?.isContainCaret),
      });
    }
    return result;
  }
}

function appendNamespaces(items: SqlCompletionItem[], seen: Set<string>, catalog: QueryCompletionCatalog): void {
  for (const namespace of catalog.namespaces) {
    const name = namespace.catalog ?? namespace.schema ?? namespace.label;
    const kind: SqlCompletionKind = namespace.catalog ? "catalog" : "schema";
    appendCompletion(items, seen, {
      label: name,
      insertText: name,
      kind,
      detail: namespace.label,
      sortText: `20:${name}`,
    });
  }
}

function appendRelations(items: SqlCompletionItem[], seen: Set<string>, catalog: QueryCompletionCatalog): void {
  for (const namespace of catalog.namespaces) {
    for (const relation of namespace.relations) {
      appendCompletion(items, seen, {
        label: relation.name,
        insertText: relation.name,
        kind: relation.kind,
        detail: `${relation.kind} · ${namespace.label}`,
        sortText: `10:${relation.name}`,
      });
    }
  }
}

function appendColumns(
  items: SqlCompletionItem[],
  seen: Set<string>,
  catalog: QueryCompletionCatalog,
  entities: readonly SqlEntityReference[],
  qualifier?: string,
): void {
  const activeRelations = new Set(
    entities
      .filter((entity) => entity.kind === "table" || entity.kind === "view")
      .flatMap((entity) => [entity.name, ...(entity.alias ? [entity.alias] : [])])
      .map((name) => name.toLowerCase()),
  );

  for (const namespace of catalog.namespaces) {
    for (const relation of namespace.relations) {
      const relationMatchesQualifier = qualifier
        ? relation.name.toLowerCase() === qualifier.toLowerCase()
          || entities.some((entity) => entity.name.toLowerCase() === relation.name.toLowerCase() && entity.alias?.toLowerCase() === qualifier.toLowerCase())
        : true;
      if (!relationMatchesQualifier) continue;
      if (!qualifier && activeRelations.size > 0 && !activeRelations.has(relation.name.toLowerCase())) continue;
      for (const column of relation.columns) {
        appendCompletion(items, seen, {
          label: column.name,
          insertText: column.name,
          kind: "column",
          detail: `${relation.name}.${column.name}${column.databaseType ? ` · ${column.databaseType}` : column.dataType ? ` · ${column.dataType}` : ""}`,
          sortText: `00:${column.name}`,
        });
      }
    }
  }
}

function appendCompletion(items: SqlCompletionItem[], seen: Set<string>, item: SqlCompletionItem): void {
  const key = `${item.kind}\u001f${item.label}\u001f${item.detail ?? ""}`;
  if (seen.has(key)) return;
  seen.add(key);
  items.push(item);
}

function completionLexicalContext(sql: string, position: SqlPosition): "relation" | "column" | "unknown" {
  const before = textBeforePosition(sql, position);
  if (/\b(?:from|join|update|into|table)\s+(?:[`"\w$]+\.)?[`"\w$]*$/iu.test(before)) return "relation";
  if (/\b(?:select|where|having|on|set|by|and|or)\b[^;]*$/iu.test(before)) return "column";
  return "unknown";
}

function currentQualifier(sql: string, position: SqlPosition): string | undefined {
  const before = textBeforePosition(sql, position);
  const match = /([`"]?[A-Za-z_$][\w$]*[`"]?)\.[A-Za-z0-9_$]*$/u.exec(before);
  return match?.[1] ? unquoteIdentifier(match[1]) : undefined;
}

function textBeforePosition(sql: string, position: SqlPosition): string {
  const lines = sql.split(/\r?\n/u);
  const lineIndex = Math.max(0, position.lineNumber - 1);
  const beforeLines = lines.slice(0, lineIndex);
  const line = lines[lineIndex] ?? "";
  return [...beforeLines, line.slice(0, Math.max(0, position.column - 1))].join("\n");
}

function hasContext(contexts: ReadonlySet<string>, fragments: readonly string[]): boolean {
  for (const context of contexts) {
    if (fragments.some((fragment) => context.includes(fragment))) return true;
  }
  return false;
}

function entityKind(value: string): SqlEntityKind {
  const normalized = value.toLowerCase();
  if (normalized.includes("table")) return "table";
  if (normalized.includes("view")) return "view";
  if (normalized.includes("column") || normalized.includes("field")) return "column";
  if (normalized.includes("database") || normalized.includes("catalog")) return "database";
  if (normalized.includes("schema")) return "schema";
  return "unknown";
}

function unquoteIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "`" && last === "`") || (first === '"' && last === '"')) return trimmed.slice(1, -1);
  }
  return trimmed;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

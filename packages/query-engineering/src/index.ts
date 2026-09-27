import {
  Schema,
  SqlSession,
  statementSpans,
  type Completion,
  type Diagnostic as SqllensSemanticDiagnostic,
  type SchemaMapping,
} from "sqllens";
import { format as formatSql } from "sql-formatter";

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
  readonly source: "parser" | "catalog" | "semantic";
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

export type SqlCompletionKind =
  | "keyword"
  | "catalog"
  | "schema"
  | "table"
  | "view"
  | "column"
  | "cte"
  | "function"
  | "template";

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
  parse(sql: string, position?: SqlPosition, catalog?: QueryCompletionCatalog): SqlParseResult;
  complete(sql: string, position: SqlPosition, catalog?: QueryCompletionCatalog): readonly SqlCompletionItem[];
  format(sql: string): string;
}

export const supportedQueryDialects: readonly SqlDialectId[] = Object.freeze(["mysql"]);

export function createQueryLanguageService(providerId: string): QueryLanguageService {
  const normalized = providerId.trim().toLowerCase();
  if (normalized === "mysql" || normalized === "mariadb") return new MySqlQueryLanguageService();
  throw new Error(`Query language intelligence does not yet support provider '${providerId}'.`);
}

export class MySqlQueryLanguageService implements QueryLanguageService {
  readonly dialect: SqlDialectId = "mysql";

  parse(sql: string, position?: SqlPosition, catalog?: QueryCompletionCatalog): SqlParseResult {
    const schema = schemaForCatalog(catalog);
    const session = SqlSession.create(sql, this.dialect, schema ? { schema } : {});
    const syntaxDiagnostics: SqlDiagnostic[] = session.syntaxDiagnostics.map((diagnostic) => {
      const startColumn = diagnostic.column + 1;
      return {
        severity: "error",
        source: "parser",
        message: diagnostic.message,
        startLineNumber: diagnostic.line,
        startColumn,
        endLineNumber: diagnostic.line,
        endColumn: startColumn + Math.max(diagnostic.length, 1),
      };
    });

    const semanticDiagnostics = schema && syntaxDiagnostics.length === 0
      ? session.qualify().diagnostics.map(normalizeSemanticDiagnostic)
      : [];

    const statements: SqlStatement[] = statementSpans(sql, this.dialect)
      .map((span) => {
        const start = offsetToPosition(sql, span.start);
        const end = offsetToPosition(sql, span.end);
        return {
          text: sql.slice(span.start, span.end),
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        };
      })
      .filter((statement) => statement.text.trim().length > 0);

    return {
      dialect: this.dialect,
      diagnostics: [...syntaxDiagnostics, ...semanticDiagnostics],
      statements,
      entities: sourceEntities(session, position ? positionToOffset(sql, position) : undefined),
    };
  }

  complete(sql: string, position: SqlPosition, catalog?: QueryCompletionCatalog): readonly SqlCompletionItem[] {
    const schema = schemaForCatalog(catalog);
    const session = SqlSession.create(sql, this.dialect, schema ? { schema } : {});
    const offset = positionToOffset(sql, position);
    const completions = session.completeAt(offset);
    const result: SqlCompletionItem[] = [];
    const seen = new Set<string>();

    for (const completion of completions) {
      const item = normalizeCompletion(completion, catalog);
      const key = `${item.kind}\u001f${item.label}\u001f${item.detail ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(item);
    }
    return result;
  }

  format(sql: string): string {
    if (!sql.trim()) return sql;
    try {
      return formatSql(sql, {
        language: "mysql",
        keywordCase: "upper",
        tabWidth: 2,
        linesBetweenQueries: 1,
      });
    } catch {
      return sql;
    }
  }
}

function schemaForCatalog(catalog?: QueryCompletionCatalog): Schema | undefined {
  if (!catalog || catalog.providerId.trim().toLowerCase() !== "mysql") return undefined;
  return new Schema(toMySqlSchema(catalog));
}

function normalizeSemanticDiagnostic(diagnostic: SqllensSemanticDiagnostic): SqlDiagnostic {
  const startColumn = diagnostic.column + 1;
  const endColumn = diagnostic.endColumn + 1;
  const source: SqlDiagnostic["source"] = diagnostic.kind === "wrong-arity" || diagnostic.kind === "wrong-argument-type"
    ? "semantic"
    : "catalog";
  return {
    severity: "warning",
    source,
    message: diagnostic.message,
    startLineNumber: diagnostic.line,
    startColumn,
    endLineNumber: diagnostic.endLine,
    endColumn: diagnostic.endLine === diagnostic.line
      ? Math.max(endColumn, startColumn + 1)
      : Math.max(endColumn, 1),
  };
}

function sourceEntities(session: SqlSession, offset?: number): SqlEntityReference[] {
  const scope = offset === undefined ? session.scopes.root : session.scopeAt(offset) ?? session.scopes.root;
  const result: SqlEntityReference[] = [];
  for (const entry of scope.sourceList) {
    const source = entry.source;
    if (source.kind === "table") {
      const name = source.name[source.name.length - 1] ?? entry.key;
      result.push({
        kind: "table",
        name,
        ...(entry.key && entry.key.toLowerCase() !== name.toLowerCase() ? { alias: entry.key } : {}),
        inActiveStatement: true,
      });
    } else if (source.kind === "cte") {
      result.push({ kind: "table", name: entry.key, inActiveStatement: true });
    }
  }
  return result;
}

function normalizeCompletion(completion: Completion, catalog?: QueryCompletionCatalog): SqlCompletionItem {
  const relation = completion.kind === "table" ? findRelation(catalog, completion.label) : undefined;
  const namespace = completion.kind === "namespace" ? findNamespace(catalog, completion.label) : undefined;
  const kind: SqlCompletionKind = relation?.kind
    ?? (namespace ? (namespace.catalog ? "catalog" : "schema") : mapCompletionKind(completion.kind));
  const detail = completion.detail
    ?? (relation ? `${relation.kind} · ${relation.namespace}` : undefined)
    ?? (namespace?.label);
  return {
    label: completion.label,
    insertText: completion.label,
    kind,
    ...(detail ? { detail } : {}),
    sortText: `${completionRank(kind)}:${completion.label.toLowerCase()}`,
  };
}

function mapCompletionKind(kind: Completion["kind"]): SqlCompletionKind {
  switch (kind) {
    case "keyword": return "keyword";
    case "column": return "column";
    case "table": return "table";
    case "cte": return "cte";
    case "namespace": return "schema";
    case "function": return "function";
    case "template": return "template";
  }
}

function completionRank(kind: SqlCompletionKind): string {
  switch (kind) {
    case "column": return "00";
    case "table":
    case "view":
    case "cte": return "10";
    case "catalog":
    case "schema": return "20";
    case "function": return "30";
    case "keyword": return "90";
    case "template": return "95";
  }
}

function findRelation(
  catalog: QueryCompletionCatalog | undefined,
  label: string,
): { kind: "table" | "view"; namespace: string } | undefined {
  if (!catalog) return undefined;
  const normalized = label.toLowerCase();
  for (const namespace of catalog.namespaces) {
    const relation = namespace.relations.find((candidate) => candidate.name.toLowerCase() === normalized);
    if (relation) return { kind: relation.kind, namespace: namespace.label };
  }
  return undefined;
}

function findNamespace(catalog: QueryCompletionCatalog | undefined, label: string): QueryCatalogNamespace | undefined {
  const normalized = label.toLowerCase();
  return catalog?.namespaces.find((namespace) =>
    namespace.catalog?.toLowerCase() === normalized
    || namespace.schema?.toLowerCase() === normalized
    || namespace.label.toLowerCase() === normalized);
}

function toMySqlSchema(catalog: QueryCompletionCatalog): SchemaMapping {
  const mapping: SchemaMapping = {};
  for (const namespace of catalog.namespaces) {
    const namespaceName = namespace.schema ?? namespace.catalog;
    const target = namespaceName ? ensureMapping(mapping, namespaceName) : mapping;
    for (const relation of namespace.relations) {
      const columns: Record<string, string> = {};
      for (const column of relation.columns) {
        columns[column.name] = column.databaseType ?? column.dataType ?? "unknown";
      }
      target[relation.name] = columns;
    }
  }
  return mapping;
}

function ensureMapping(mapping: SchemaMapping, key: string): SchemaMapping {
  const current = mapping[key];
  if (typeof current === "object" && current !== null && !("nullable" in current)) return current as SchemaMapping;
  const created: SchemaMapping = {};
  mapping[key] = created;
  return created;
}

function positionToOffset(sql: string, position: SqlPosition): number {
  const targetLine = Math.max(position.lineNumber, 1);
  const targetColumn = Math.max(position.column, 1);
  let line = 1;
  let index = 0;
  while (line < targetLine && index < sql.length) {
    const char = sql[index++];
    if (char === "\n") line += 1;
  }
  return Math.min(index + targetColumn - 1, sql.length);
}

function offsetToPosition(sql: string, offset: number): SqlPosition {
  const bounded = Math.min(Math.max(offset, 0), sql.length);
  const before = sql.slice(0, bounded);
  const lines = before.split("\n");
  return {
    lineNumber: lines.length,
    column: (lines[lines.length - 1]?.replace(/\r$/u, "").length ?? 0) + 1,
  };
}

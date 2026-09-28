import { Pool, type PoolClient, type QueryResult } from "pg";
import type {
  ColumnDefinition,
  DatabaseCatalog,
  DatabaseNamespace,
  DatabaseNamespaceReference,
  DatabaseNamespaceSummary,
  DatabaseObjectSummary,
  ForeignKeyDefinition,
  IndexDefinition,
  TableDefinition,
} from "@nublox/workbench-catalog";
import type {
  DatabaseCapabilities,
  DatabaseConnectionConfig,
  DatabaseExplorerProvider,
  DatabaseProvider,
  DatabaseSession,
  ExplainPlan,
  ExplorerNamespaceOptions,
  ExplorerObjectReference,
  IntrospectionOptions,
  QueryExecution,
  QueryRequest,
  QueryResultSet,
  SessionHealth,
} from "@nublox/workbench-provider-api";

type Row = Record<string, unknown>;

interface NamespaceRow extends Row { schemaName: string; }
interface TableRow extends Row { schemaName: string; tableName: string; tableType: string; estimatedRows: number | string | null; }
interface ColumnRow extends Row { schemaName: string; tableName: string; columnName: string; ordinalPosition: number | string; dataType: string; databaseType: string; nullable: string; defaultValue: unknown; characterLength: number | string | null; numericPrecision: number | string | null; numericScale: number | string | null; datetimePrecision: number | string | null; generated: string; generationExpression: string | null; }
interface IndexRow extends Row { schemaName: string; tableName: string; indexName: string; primary: boolean; unique: boolean; accessMethod: string; sequence: number | string; columnName: string; direction: string | null; }
interface ForeignKeyRow extends Row { schemaName: string; tableName: string; constraintName: string; sequence: number | string; columnName: string; referencedSchemaName: string; referencedTableName: string; referencedColumnName: string; updateRule: string | null; deleteRule: string | null; }
interface VersionRow extends Row { version: string; databaseName: string; }

const SYSTEM_SCHEMAS = new Set(["pg_catalog", "information_schema"]);

export const postgresqlCapabilities: DatabaseCapabilities = Object.freeze({
  catalogIntrospection: true,
  schemas: true,
  views: true,
  indexes: true,
  foreignKeys: true,
  procedures: true,
  functions: true,
  triggers: true,
  events: false,
  partitions: true,
  transactions: true,
  savepoints: true,
  explainPlan: true,
  queryCancellation: false,
  objectSearch: false,
  privilegeIntrospection: false,
  serverAdministration: false,
  userAdministration: false,
});

export class PostgreSqlDatabaseProvider implements DatabaseProvider {
  readonly id = "postgresql";
  readonly displayName = "PostgreSQL";
  readonly capabilities = postgresqlCapabilities;
  readonly explorer: DatabaseExplorerProvider = new PostgreSqlExplorerProvider();

  async connect(config: DatabaseConnectionConfig): Promise<DatabaseSession> {
    if (config.providerId.trim().toLowerCase() !== this.id) {
      throw new Error(`PostgreSQL provider cannot open provider '${config.providerId}'.`);
    }

    const options = config.options ?? {};
    const pool = new Pool({
      host: config.host,
      port: config.port ?? 5432,
      user: config.user,
      ...(config.password !== undefined ? { password: config.password } : {}),
      ...(config.database !== undefined ? { database: config.database } : {}),
      ...(config.connectTimeoutMs !== undefined ? { connectionTimeoutMillis: config.connectTimeoutMs } : {}),
      ...(config.tls ? {
        ssl: {
          ...(config.tls.ca !== undefined ? { ca: config.tls.ca } : {}),
          ...(config.tls.cert !== undefined ? { cert: config.tls.cert } : {}),
          ...(config.tls.key !== undefined ? { key: config.tls.key } : {}),
          rejectUnauthorized: config.tls.rejectUnauthorized ?? true,
        },
      } : {}),
      max: numberOption(options.maxConnections, 10),
      idleTimeoutMillis: numberOption(options.idleTimeoutMs, 30_000),
      allowExitOnIdle: booleanOption(options.allowExitOnIdle, false),
    });

    try {
      const client = await pool.connect();
      client.release();
    } catch (error) {
      await pool.end();
      throw new Error(`Unable to connect to PostgreSQL: ${errorMessage(error)}`);
    }

    return new PostgreSqlSession(createSessionId(), pool, config.host);
  }

  async introspect(session: DatabaseSession, options: IntrospectionOptions = {}): Promise<DatabaseCatalog> {
    const postgresSession = requirePostgreSqlSession(session);
    const depth = options.depth ?? "full";
    const version = await postgresSession.pool.query<VersionRow>(VERSION_SQL);
    const namespaces = await loadNamespaces(postgresSession, options.includeSystem ?? false);
    const selectedSchemas = filterRequestedSchemas(namespaces.map((row) => row.schemaName), options.catalogs);

    const tableRows = depth === "namespaces" ? [] : await loadTables(postgresSession, selectedSchemas);
    const columnRows = depth === "full" ? await loadColumns(postgresSession, selectedSchemas) : [];
    const indexRows = depth === "full" ? await loadIndexes(postgresSession, selectedSchemas) : [];
    const foreignKeyRows = depth === "full" ? await loadForeignKeys(postgresSession, selectedSchemas) : [];

    const columnsByTable = groupBy(columnRows, (row) => tableKey(row.schemaName, row.tableName));
    const indexesByTable = buildIndexes(indexRows);
    const foreignKeysByTable = buildForeignKeys(foreignKeyRows);
    const tablesBySchema = groupBy(tableRows, (row) => row.schemaName);

    const catalogNamespaces: DatabaseNamespace[] = namespaces
      .filter((row) => selectedSchemas.includes(row.schemaName))
      .map((row) => ({
        catalog: version.rows[0]?.databaseName,
        schema: row.schemaName,
        system: isSystemSchema(row.schemaName),
        tables: (tablesBySchema.get(row.schemaName) ?? []).map((table) => mapTable(
          version.rows[0]?.databaseName,
          table,
          columnsByTable.get(tableKey(table.schemaName, table.tableName)) ?? [],
          indexesByTable.get(tableKey(table.schemaName, table.tableName)) ?? [],
          foreignKeysByTable.get(tableKey(table.schemaName, table.tableName)) ?? [],
        )),
      }));

    return {
      providerId: this.id,
      server: {
        product: "PostgreSQL",
        ...(version.rows[0]?.version ? { version: version.rows[0].version } : {}),
        host: postgresSession.host,
      },
      namespaces: catalogNamespaces,
      capturedAt: new Date().toISOString(),
    };
  }

  async execute(session: DatabaseSession, request: QueryRequest): Promise<QueryExecution> {
    const postgresSession = requirePostgreSqlSession(session);
    if (request.signal) {
      throw new Error("PostgreSQL query cancellation is not yet enabled in the provider foundation.");
    }
    if (request.values && !Array.isArray(request.values)) {
      throw new Error("PostgreSQL provider currently accepts positional parameter arrays only.");
    }

    const startedAt = new Date();
    const startedMs = Date.now();
    const result = await postgresSession.pool.query({
      text: request.sql,
      values: request.values ? [...request.values] : undefined,
      ...(request.timeoutMs !== undefined ? { query_timeout: request.timeoutMs } : {}),
    });
    const finishedAt = new Date();

    return {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: Date.now() - startedMs,
      resultSets: [normalizeResult(result)],
    };
  }

  async explain(session: DatabaseSession, request: QueryRequest): Promise<ExplainPlan> {
    const execution = await this.execute(session, {
      ...request,
      sql: `EXPLAIN (FORMAT JSON) ${request.sql}`,
    });
    return { format: "postgresql-json", raw: execution.resultSets };
  }

  quoteIdentifier(identifier: string): string {
    return `"${identifier.replaceAll('"', '""')}"`;
  }
}

class PostgreSqlExplorerProvider implements DatabaseExplorerProvider {
  async listNamespaces(session: DatabaseSession, options: ExplorerNamespaceOptions = {}): Promise<readonly DatabaseNamespaceSummary[]> {
    const postgresSession = requirePostgreSqlSession(session);
    const version = await postgresSession.pool.query<VersionRow>(VERSION_SQL);
    const rows = await loadNamespaces(postgresSession, options.includeSystem ?? false);
    return rows.map((row) => ({
      catalog: version.rows[0]?.databaseName,
      schema: row.schemaName,
      system: isSystemSchema(row.schemaName),
    }));
  }

  async listObjects(session: DatabaseSession, namespace: DatabaseNamespaceReference): Promise<readonly DatabaseObjectSummary[]> {
    const postgresSession = requirePostgreSqlSession(session);
    const schema = requireSchema(namespace);
    const version = await postgresSession.pool.query<VersionRow>(VERSION_SQL);
    const rows = await postgresSession.pool.query<TableRow>(TABLE_FOR_SCHEMA_SQL, [schema]);
    return rows.rows.map((row) => ({
      catalog: version.rows[0]?.databaseName,
      schema: row.schemaName,
      name: row.tableName,
      kind: row.tableType === "VIEW" ? "view" : "table",
    }));
  }

  async describeTable(session: DatabaseSession, object: ExplorerObjectReference): Promise<TableDefinition> {
    const postgresSession = requirePostgreSqlSession(session);
    const schema = requireSchema(object);
    const name = requireName(object.name, "Object name");
    const version = await postgresSession.pool.query<VersionRow>(VERSION_SQL);
    const [tables, columns, indexes, foreignKeys] = await Promise.all([
      postgresSession.pool.query<TableRow>(TABLE_DETAIL_SQL, [schema, name]),
      postgresSession.pool.query<ColumnRow>(COLUMN_DETAIL_SQL, [schema, name]),
      postgresSession.pool.query<IndexRow>(INDEX_DETAIL_SQL, [schema, name]),
      postgresSession.pool.query<ForeignKeyRow>(FOREIGN_KEY_DETAIL_SQL, [schema, name]),
    ]);
    const table = tables.rows[0];
    if (!table) throw new Error(`PostgreSQL object '${schema}.${name}' does not exist or is not visible.`);
    return mapTable(
      version.rows[0]?.databaseName,
      table,
      columns.rows,
      buildIndexes(indexes.rows).get(tableKey(schema, name)) ?? [],
      buildForeignKeys(foreignKeys.rows).get(tableKey(schema, name)) ?? [],
    );
  }

  async listRoutines(): Promise<readonly []> { return []; }
  async listTriggers(): Promise<readonly []> { return []; }
  async listEvents(): Promise<readonly []> { return []; }
  async listPrincipals(): Promise<readonly []> { return []; }
  async listRoleGrants(): Promise<readonly []> { return []; }
  async listPrivileges(): Promise<readonly []> { return []; }
  async search(): Promise<readonly []> { return []; }
}

class PostgreSqlSession implements DatabaseSession {
  readonly providerId = "postgresql";
  readonly connectedAt = new Date().toISOString();

  constructor(
    readonly id: string,
    readonly pool: Pool,
    readonly host: string,
  ) {}

  async health(): Promise<SessionHealth> {
    const started = Date.now();
    try {
      await this.pool.query("SELECT 1");
      return { ok: true, latencyMs: Date.now() - started };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - started, message: errorMessage(error) };
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function requirePostgreSqlSession(session: DatabaseSession): PostgreSqlSession {
  if (!(session instanceof PostgreSqlSession)) throw new Error("Session was not created by the PostgreSQL provider.");
  return session;
}

function requireSchema(value: DatabaseNamespaceReference): string {
  const schema = value.schema?.trim();
  if (!schema) throw new Error("PostgreSQL operations require a schema name.");
  return schema;
}

function requireName(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function normalizeResult(result: QueryResult): QueryResultSet {
  return {
    columns: result.fields.map((field) => ({ name: field.name, databaseType: String(field.dataTypeID) })),
    rows: result.rows as readonly Readonly<Record<string, unknown>>[],
    ...(result.rowCount !== null ? { affectedRows: result.rowCount } : {}),
    message: result.command,
  };
}

function mapTable(
  catalog: string | undefined,
  table: TableRow,
  columns: readonly ColumnRow[],
  indexes: readonly IndexDefinition[],
  foreignKeys: readonly ForeignKeyDefinition[],
): TableDefinition {
  return {
    ...(catalog ? { catalog } : {}),
    schema: table.schemaName,
    name: table.tableName,
    kind: table.tableType === "VIEW" ? "view" : "table",
    ...(toNumber(table.estimatedRows) !== undefined ? { estimatedRows: toNumber(table.estimatedRows)! } : {}),
    columns: columns.map(mapColumn),
    indexes,
    foreignKeys,
  };
}

function mapColumn(row: ColumnRow): ColumnDefinition {
  return {
    name: row.columnName,
    ordinal: Number(row.ordinalPosition),
    dataType: row.dataType,
    databaseType: row.databaseType,
    nullable: row.nullable === "YES",
    ...(row.defaultValue !== null && row.defaultValue !== undefined ? { defaultValue: row.defaultValue } : {}),
    ...(toNumber(row.characterLength) !== undefined ? { characterLength: toNumber(row.characterLength)! } : {}),
    ...(toNumber(row.numericPrecision) !== undefined ? { numericPrecision: toNumber(row.numericPrecision)! } : {}),
    ...(toNumber(row.numericScale) !== undefined ? { numericScale: toNumber(row.numericScale)! } : {}),
    ...(toNumber(row.datetimePrecision) !== undefined ? { datetimePrecision: toNumber(row.datetimePrecision)! } : {}),
    autoIncrement: typeof row.defaultValue === "string" && row.defaultValue.includes("nextval("),
    generated: row.generated === "ALWAYS",
    ...(row.generationExpression ? { generationExpression: row.generationExpression } : {}),
  };
}

function buildIndexes(rows: readonly IndexRow[]): Map<string, IndexDefinition[]> {
  const grouped = groupBy(rows, (row) => `${tableKey(row.schemaName, row.tableName)}\u001f${row.indexName}`);
  const byTable = new Map<string, IndexDefinition[]>();
  for (const indexRows of grouped.values()) {
    const first = indexRows[0]!;
    const definition: IndexDefinition = {
      name: first.indexName,
      primary: Boolean(first.primary),
      unique: Boolean(first.unique),
      type: first.accessMethod,
      columns: [...indexRows]
        .sort((a, b) => Number(a.sequence) - Number(b.sequence))
        .map((row) => ({
          name: row.columnName,
          sequence: Number(row.sequence),
          ...(row.direction?.toLowerCase() === "desc" ? { direction: "desc" as const } : { direction: "asc" as const }),
        })),
    };
    const key = tableKey(first.schemaName, first.tableName);
    byTable.set(key, [...(byTable.get(key) ?? []), definition]);
  }
  return byTable;
}

function buildForeignKeys(rows: readonly ForeignKeyRow[]): Map<string, ForeignKeyDefinition[]> {
  const grouped = groupBy(rows, (row) => `${tableKey(row.schemaName, row.tableName)}\u001f${row.constraintName}`);
  const byTable = new Map<string, ForeignKeyDefinition[]>();
  for (const fkRows of grouped.values()) {
    const sorted = [...fkRows].sort((a, b) => Number(a.sequence) - Number(b.sequence));
    const first = sorted[0]!;
    const definition: ForeignKeyDefinition = {
      name: first.constraintName,
      columns: sorted.map((row) => row.columnName),
      referencedSchema: first.referencedSchemaName,
      referencedTable: first.referencedTableName,
      referencedColumns: sorted.map((row) => row.referencedColumnName),
      ...(first.updateRule ? { updateRule: first.updateRule } : {}),
      ...(first.deleteRule ? { deleteRule: first.deleteRule } : {}),
    };
    const key = tableKey(first.schemaName, first.tableName);
    byTable.set(key, [...(byTable.get(key) ?? []), definition]);
  }
  return byTable;
}

async function loadNamespaces(session: PostgreSqlSession, includeSystem: boolean): Promise<NamespaceRow[]> {
  const result = await session.pool.query<NamespaceRow>(NAMESPACE_SQL);
  return result.rows.filter((row) => includeSystem || !isSystemSchema(row.schemaName));
}

async function loadTables(session: PostgreSqlSession, schemas: readonly string[]): Promise<TableRow[]> {
  if (!schemas.length) return [];
  const result = await session.pool.query<TableRow>(TABLE_FOR_SCHEMAS_SQL, [schemas]);
  return result.rows;
}

async function loadColumns(session: PostgreSqlSession, schemas: readonly string[]): Promise<ColumnRow[]> {
  if (!schemas.length) return [];
  const result = await session.pool.query<ColumnRow>(COLUMN_FOR_SCHEMAS_SQL, [schemas]);
  return result.rows;
}

async function loadIndexes(session: PostgreSqlSession, schemas: readonly string[]): Promise<IndexRow[]> {
  if (!schemas.length) return [];
  const result = await session.pool.query<IndexRow>(INDEX_FOR_SCHEMAS_SQL, [schemas]);
  return result.rows;
}

async function loadForeignKeys(session: PostgreSqlSession, schemas: readonly string[]): Promise<ForeignKeyRow[]> {
  if (!schemas.length) return [];
  const result = await session.pool.query<ForeignKeyRow>(FOREIGN_KEY_FOR_SCHEMAS_SQL, [schemas]);
  return result.rows;
}

function filterRequestedSchemas(available: readonly string[], requested?: readonly string[]): string[] {
  if (!requested?.length) return [...available];
  const requestedSet = new Set(requested.map((value) => value.toLowerCase()));
  return available.filter((schema) => requestedSet.has(schema.toLowerCase()));
}

function isSystemSchema(schema: string): boolean {
  return SYSTEM_SCHEMAS.has(schema.toLowerCase()) || schema.toLowerCase().startsWith("pg_toast");
}

function tableKey(schema: string, table: string): string { return `${schema}\u001f${table}`; }
function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> { const map = new Map<string, T[]>(); for (const value of values) { const itemKey = key(value); map.set(itemKey, [...(map.get(itemKey) ?? []), value]); } return map; }
function toNumber(value: number | string | null): number | undefined { if (value === null || value === "") return undefined; const number = Number(value); return Number.isFinite(number) ? number : undefined; }
function numberOption(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback; }
function booleanOption(value: unknown, fallback: boolean): boolean { return typeof value === "boolean" ? value : fallback; }
function createSessionId(): string { return `postgresql-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

const VERSION_SQL = `SELECT version() AS "version", current_database() AS "databaseName"`;
const NAMESPACE_SQL = `SELECT schema_name AS "schemaName" FROM information_schema.schemata ORDER BY schema_name`;
const TABLE_FOR_SCHEMA_SQL = `SELECT table_schema AS "schemaName", table_name AS "tableName", table_type AS "tableType", NULL::bigint AS "estimatedRows" FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`;
const TABLE_FOR_SCHEMAS_SQL = `SELECT t.table_schema AS "schemaName", t.table_name AS "tableName", t.table_type AS "tableType", c.reltuples::bigint AS "estimatedRows" FROM information_schema.tables t LEFT JOIN pg_catalog.pg_class c ON c.relname = t.table_name LEFT JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema WHERE t.table_schema = ANY($1::text[]) ORDER BY t.table_schema, t.table_name`;
const TABLE_DETAIL_SQL = `SELECT t.table_schema AS "schemaName", t.table_name AS "tableName", t.table_type AS "tableType", c.reltuples::bigint AS "estimatedRows" FROM information_schema.tables t LEFT JOIN pg_catalog.pg_class c ON c.relname = t.table_name LEFT JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema WHERE t.table_schema = $1 AND t.table_name = $2 LIMIT 1`;
const COLUMN_FOR_SCHEMAS_SQL = `SELECT table_schema AS "schemaName", table_name AS "tableName", column_name AS "columnName", ordinal_position AS "ordinalPosition", data_type AS "dataType", udt_name AS "databaseType", is_nullable AS "nullable", column_default AS "defaultValue", character_maximum_length AS "characterLength", numeric_precision AS "numericPrecision", numeric_scale AS "numericScale", datetime_precision AS "datetimePrecision", is_generated AS "generated", generation_expression AS "generationExpression" FROM information_schema.columns WHERE table_schema = ANY($1::text[]) ORDER BY table_schema, table_name, ordinal_position`;
const COLUMN_DETAIL_SQL = `SELECT table_schema AS "schemaName", table_name AS "tableName", column_name AS "columnName", ordinal_position AS "ordinalPosition", data_type AS "dataType", udt_name AS "databaseType", is_nullable AS "nullable", column_default AS "defaultValue", character_maximum_length AS "characterLength", numeric_precision AS "numericPrecision", numeric_scale AS "numericScale", datetime_precision AS "datetimePrecision", is_generated AS "generated", generation_expression AS "generationExpression" FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`;
const INDEX_FOR_SCHEMAS_SQL = `SELECT ns.nspname AS "schemaName", tbl.relname AS "tableName", idx.relname AS "indexName", i.indisprimary AS "primary", i.indisunique AS "unique", am.amname AS "accessMethod", ord.n AS "sequence", att.attname AS "columnName", CASE WHEN (i.indoption[ord.n - 1] & 1) = 1 THEN 'desc' ELSE 'asc' END AS "direction" FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class tbl ON tbl.oid = i.indrelid JOIN pg_catalog.pg_namespace ns ON ns.oid = tbl.relnamespace JOIN pg_catalog.pg_class idx ON idx.oid = i.indexrelid JOIN pg_catalog.pg_am am ON am.oid = idx.relam CROSS JOIN LATERAL generate_subscripts(i.indkey, 1) ord(n) JOIN pg_catalog.pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = i.indkey[ord.n] WHERE ns.nspname = ANY($1::text[]) ORDER BY ns.nspname, tbl.relname, idx.relname, ord.n`;
const INDEX_DETAIL_SQL = `${INDEX_FOR_SCHEMAS_SQL.replace('ns.nspname = ANY($1::text[])', 'ns.nspname = $1 AND tbl.relname = $2')}`;
const FOREIGN_KEY_FOR_SCHEMAS_SQL = `SELECT tc.table_schema AS "schemaName", tc.table_name AS "tableName", tc.constraint_name AS "constraintName", kcu.ordinal_position AS "sequence", kcu.column_name AS "columnName", ccu.table_schema AS "referencedSchemaName", ccu.table_name AS "referencedTableName", ccu.column_name AS "referencedColumnName", rc.update_rule AS "updateRule", rc.delete_rule AS "deleteRule" FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.constraint_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = ANY($1::text[]) ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position`;
const FOREIGN_KEY_DETAIL_SQL = `${FOREIGN_KEY_FOR_SCHEMAS_SQL.replace("tc.table_schema = ANY($1::text[])", "tc.table_schema = $1 AND tc.table_name = $2")}`;

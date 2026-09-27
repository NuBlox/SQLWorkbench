import mysql from "@nublox/mysql/promise";
import type {
  ColumnDefinition,
  DatabaseCatalog,
  DatabaseNamespace,
  ForeignKeyDefinition,
  IndexColumnDefinition,
  IndexDefinition,
  TableDefinition,
} from "@nublox/workbench-catalog";
import type {
  DatabaseCapabilities,
  DatabaseConnectionConfig,
  DatabaseProvider,
  DatabaseSession,
  ExplainPlan,
  IntrospectionOptions,
  QueryColumn,
  QueryExecution,
  QueryRequest,
  QueryResultSet,
  SessionHealth,
} from "@nublox/workbench-provider-api";

type MySqlPool = ReturnType<typeof mysql.createPool>;

type Row = Record<string, unknown>;

interface SchemaRow extends Row {
  schemaName: string;
  defaultCharacterSet: string;
  defaultCollation: string;
}

interface TableRow extends Row {
  schemaName: string;
  tableName: string;
  tableType: string;
  engine: string | null;
  estimatedRows: number | string | null;
  comment: string | null;
}

interface ColumnRow extends Row {
  schemaName: string;
  tableName: string;
  columnName: string;
  ordinalPosition: number | string;
  defaultValue: unknown;
  isNullable: string;
  dataType: string;
  columnType: string;
  characterLength: number | string | null;
  numericPrecision: number | string | null;
  numericScale: number | string | null;
  datetimePrecision: number | string | null;
  extra: string;
  comment: string | null;
  generationExpression: string | null;
}

interface IndexRow extends Row {
  schemaName: string;
  tableName: string;
  indexName: string;
  nonUnique: number | string;
  sequence: number | string;
  columnName: string | null;
  collation: string | null;
  indexType: string | null;
  prefixLength: number | string | null;
}

interface ForeignKeyRow extends Row {
  schemaName: string;
  tableName: string;
  constraintName: string;
  ordinalPosition: number | string;
  columnName: string;
  referencedSchemaName: string;
  referencedTableName: string;
  referencedColumnName: string;
  updateRule: string | null;
  deleteRule: string | null;
}

interface VersionRow extends Row {
  version: string;
}

export const mysqlCapabilities: DatabaseCapabilities = Object.freeze({
  catalogIntrospection: true,
  schemas: false,
  views: true,
  indexes: true,
  foreignKeys: true,
  procedures: false,
  functions: false,
  triggers: false,
  partitions: false,
  transactions: true,
  savepoints: true,
  explainPlan: true,
  queryCancellation: true,
  serverAdministration: false,
  userAdministration: false,
});

export class MySqlDatabaseProvider implements DatabaseProvider {
  readonly id = "mysql";
  readonly displayName = "MySQL";
  readonly capabilities = mysqlCapabilities;

  async connect(config: DatabaseConnectionConfig): Promise<DatabaseSession> {
    if (config.providerId.trim().toLowerCase() !== this.id) {
      throw new Error(`MySQL provider cannot open provider '${config.providerId}'.`);
    }

    const options = config.options ?? {};
    const compressionAlgorithms = compressionOption(options.compressionAlgorithms);
    const ssl = config.tls
      ? {
          ...(config.tls.ca !== undefined ? { ca: config.tls.ca } : {}),
          ...(config.tls.cert !== undefined ? { cert: config.tls.cert } : {}),
          ...(config.tls.key !== undefined ? { key: config.tls.key } : {}),
          rejectUnauthorized: config.tls.rejectUnauthorized ?? true,
        }
      : undefined;

    const pool = mysql.createPool({
      host: config.host,
      port: config.port ?? 3306,
      user: config.user,
      ...(config.password !== undefined ? { password: config.password } : {}),
      ...(config.database !== undefined ? { database: config.database } : {}),
      ...(config.connectTimeoutMs !== undefined ? { connectTimeout: config.connectTimeoutMs } : {}),
      ...(ssl !== undefined ? { ssl } : {}),
      connectionLimit: numberOption(options.connectionLimit, 10),
      queueLimit: numberOption(options.queueLimit, 0),
      waitForConnections: booleanOption(options.waitForConnections, true),
      maxPreparedStatements: numberOption(options.maxPreparedStatements, 256),
      ...(compressionAlgorithms !== undefined ? { compressionAlgorithms } : {}),
    });

    const health = await pool.healthCheck();
    if (!health.ok) {
      await pool.end();
      throw new Error(`Unable to connect to MySQL${health.errorCode ? ` (${health.errorCode})` : ""}.`);
    }

    return new MySqlSession(createSessionId(), pool, config.host);
  }

  async introspect(session: DatabaseSession, options: IntrospectionOptions = {}): Promise<DatabaseCatalog> {
    const mysqlSession = requireMySqlSession(session);
    const depth = options.depth ?? "full";
    const [versionRows] = await mysqlSession.pool.query<VersionRow[]>("SELECT VERSION() AS version");
    const [schemaRows] = await mysqlSession.pool.query<SchemaRow[]>(SCHEMA_SQL);
    const [tableRows] = depth === "namespaces"
      ? [[] as TableRow[]]
      : await mysqlSession.pool.query<TableRow[]>(TABLE_SQL);
    const [columnRows] = depth === "full"
      ? await mysqlSession.pool.query<ColumnRow[]>(COLUMN_SQL)
      : [[] as ColumnRow[]];
    const [indexRows] = depth === "full"
      ? await mysqlSession.pool.query<IndexRow[]>(INDEX_SQL)
      : [[] as IndexRow[]];
    const [foreignKeyRows] = depth === "full"
      ? await mysqlSession.pool.query<ForeignKeyRow[]>(FOREIGN_KEY_SQL)
      : [[] as ForeignKeyRow[]];

    const requestedCatalogs = options.catalogs?.length
      ? new Set(options.catalogs.map((value) => value.toLowerCase()))
      : undefined;

    const systemCatalogs = new Set(["information_schema", "mysql", "performance_schema", "sys"]);
    const includeCatalog = (catalog: string): boolean => {
      if (requestedCatalogs && !requestedCatalogs.has(catalog.toLowerCase())) return false;
      if (!options.includeSystem && systemCatalogs.has(catalog.toLowerCase())) return false;
      return true;
    };

    const columnsByTable = groupBy(columnRows, (row) => tableKey(row.schemaName, row.tableName));
    const indexesByTable = buildIndexes(indexRows);
    const foreignKeysByTable = buildForeignKeys(foreignKeyRows);
    const tablesBySchema = groupBy(
      tableRows.filter((row) => includeCatalog(row.schemaName)),
      (row) => row.schemaName,
    );

    const namespaces: DatabaseNamespace[] = schemaRows
      .filter((row) => includeCatalog(row.schemaName))
      .map((schema) => ({
        catalog: schema.schemaName,
        defaultCharacterSet: schema.defaultCharacterSet,
        defaultCollation: schema.defaultCollation,
        system: systemCatalogs.has(schema.schemaName.toLowerCase()),
        tables: (tablesBySchema.get(schema.schemaName) ?? []).map((table) => {
          const estimatedRows = toOptionalNumber(table.estimatedRows);
          return {
            catalog: table.schemaName,
            name: table.tableName,
            kind: table.tableType.toUpperCase() === "VIEW" ? "view" : "table",
            ...(table.engine ? { engine: table.engine } : {}),
            ...(estimatedRows !== undefined ? { estimatedRows } : {}),
            ...(table.comment ? { comment: table.comment } : {}),
            columns: (columnsByTable.get(tableKey(table.schemaName, table.tableName)) ?? [])
              .sort((left, right) => Number(left.ordinalPosition) - Number(right.ordinalPosition))
              .map(mapColumn),
            indexes: indexesByTable.get(tableKey(table.schemaName, table.tableName)) ?? [],
            foreignKeys: foreignKeysByTable.get(tableKey(table.schemaName, table.tableName)) ?? [],
          } satisfies TableDefinition;
        }),
      }));

    return {
      providerId: this.id,
      server: {
        product: "MySQL",
        ...(versionRows[0]?.version ? { version: String(versionRows[0].version) } : {}),
        host: mysqlSession.host,
      },
      namespaces,
      capturedAt: new Date().toISOString(),
    };
  }

  async execute(session: DatabaseSession, request: QueryRequest): Promise<QueryExecution> {
    const mysqlSession = requireMySqlSession(session);
    const startedAt = new Date();
    const startedMs = Date.now();

    let result: unknown;
    let fields: unknown;

    if (request.mode === "prepared") {
      if (request.signal) {
        throw new Error("Prepared MySQL execution does not currently expose AbortSignal cancellation through NuBloxSQL.");
      }
      [result, fields] = await mysqlSession.pool.execute({
        sql: request.sql,
        ...(request.values ? { values: mutableValues(request.values) } : {}),
        ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
        namedPlaceholders: isNamedValues(request.values),
      });
    } else {
      [result, fields] = await mysqlSession.pool.query({
        sql: request.sql,
        ...(request.values ? { values: mutableValues(request.values) } : {}),
        ...(request.timeoutMs !== undefined ? { timeout: request.timeoutMs } : {}),
        ...(request.signal ? { signal: request.signal } : {}),
        namedPlaceholders: isNamedValues(request.values),
      });
    }

    const finishedAt = new Date();
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      elapsedMs: Date.now() - startedMs,
      resultSets: normalizeResults(result, fields),
    };
  }

  async explain(session: DatabaseSession, request: QueryRequest): Promise<ExplainPlan> {
    const execution = await this.execute(session, {
      ...request,
      mode: "text",
      sql: `EXPLAIN FORMAT=JSON ${request.sql}`,
    });

    return {
      format: "mysql-json",
      raw: execution.resultSets,
    };
  }

  quoteIdentifier(identifier: string): string {
    return `\`${identifier.replaceAll("`", "``")}\``;
  }
}

class MySqlSession implements DatabaseSession {
  readonly providerId = "mysql";
  readonly connectedAt = new Date().toISOString();

  constructor(
    readonly id: string,
    readonly pool: MySqlPool,
    readonly host: string,
  ) {}

  async health(): Promise<SessionHealth> {
    const result = await this.pool.healthCheck();
    return {
      ok: result.ok,
      latencyMs: result.latencyMs,
      ...(result.errorCode ? { message: result.errorCode } : {}),
    };
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

function requireMySqlSession(session: DatabaseSession): MySqlSession {
  if (!(session instanceof MySqlSession)) {
    throw new Error("Session was not created by the MySQL provider.");
  }
  return session;
}

function normalizeResults(result: unknown, fields: unknown): QueryResultSet[] {
  if (Array.isArray(result) && result.some((item) => Array.isArray(item) || isOkPacket(item))) {
    const fieldSets = Array.isArray(fields) ? fields : [];
    return result.map((item, index) => normalizeSingleResult(item, fieldSets[index]));
  }
  return [normalizeSingleResult(result, fields)];
}

function normalizeSingleResult(result: unknown, fields: unknown): QueryResultSet {
  if (Array.isArray(result)) {
    return {
      columns: normalizeColumns(fields),
      rows: result.filter(isRecord),
    };
  }

  if (isRecord(result)) {
    const affectedRows = numericProperty(result, "affectedRows");
    const changedRows = numericProperty(result, "changedRows");
    const insertId = numericProperty(result, "insertId");
    const warningCount = numericProperty(result, "warningCount");
    return {
      columns: [],
      rows: [],
      ...(affectedRows !== undefined ? { affectedRows } : {}),
      ...(changedRows !== undefined ? { changedRows } : {}),
      ...(insertId !== undefined ? { insertId } : {}),
      ...(warningCount !== undefined ? { warningCount } : {}),
      ...(typeof result.message === "string" ? { message: result.message } : {}),
    };
  }

  return { columns: [], rows: [] };
}

function normalizeColumns(fields: unknown): QueryColumn[] {
  if (!Array.isArray(fields)) return [];
  return fields.filter(isRecord).map((field) => ({
    name: typeof field.name === "string" ? field.name : "",
    ...(typeof field.table === "string" && field.table ? { table: field.table } : {}),
    ...(typeof field.db === "string" && field.db ? { catalog: field.db } : {}),
    ...(typeof field.type === "number" ? { databaseType: String(field.type) } : {}),
  }));
}

function mapColumn(row: ColumnRow): ColumnDefinition {
  const characterLength = toOptionalNumber(row.characterLength);
  const numericPrecision = toOptionalNumber(row.numericPrecision);
  const numericScale = toOptionalNumber(row.numericScale);
  const datetimePrecision = toOptionalNumber(row.datetimePrecision);
  return {
    name: row.columnName,
    ordinal: Number(row.ordinalPosition),
    dataType: row.dataType,
    databaseType: row.columnType,
    nullable: row.isNullable.toUpperCase() === "YES",
    ...(row.defaultValue !== null ? { defaultValue: row.defaultValue } : {}),
    ...(characterLength !== undefined ? { characterLength } : {}),
    ...(numericPrecision !== undefined ? { numericPrecision } : {}),
    ...(numericScale !== undefined ? { numericScale } : {}),
    ...(datetimePrecision !== undefined ? { datetimePrecision } : {}),
    autoIncrement: row.extra.toLowerCase().includes("auto_increment"),
    generated: row.extra.toLowerCase().includes("generated"),
    ...(row.generationExpression ? { generationExpression: row.generationExpression } : {}),
    ...(row.comment ? { comment: row.comment } : {}),
  };
}

function buildIndexes(rows: readonly IndexRow[]): Map<string, IndexDefinition[]> {
  const grouped = groupBy(rows, (row) => `${tableKey(row.schemaName, row.tableName)}\u001e${row.indexName}`);
  const result = new Map<string, IndexDefinition[]>();

  for (const indexRows of grouped.values()) {
    const first = indexRows[0];
    if (!first) continue;
    const table = tableKey(first.schemaName, first.tableName);
    const definition: IndexDefinition = {
      name: first.indexName,
      primary: first.indexName === "PRIMARY",
      unique: Number(first.nonUnique) === 0,
      ...(first.indexType ? { type: first.indexType } : {}),
      columns: indexRows
        .filter((row): row is IndexRow & { columnName: string } => Boolean(row.columnName))
        .sort((left, right) => Number(left.sequence) - Number(right.sequence))
        .map((row) => {
          const prefixLength = toOptionalNumber(row.prefixLength);
          return {
            name: row.columnName,
            sequence: Number(row.sequence),
            ...(prefixLength !== undefined ? { prefixLength } : {}),
            ...(row.collation === "A" ? { direction: "asc" as const } : {}),
            ...(row.collation === "D" ? { direction: "desc" as const } : {}),
          } satisfies IndexColumnDefinition;
        }),
    };
    const existing = result.get(table) ?? [];
    existing.push(definition);
    result.set(table, existing);
  }

  return result;
}

function buildForeignKeys(rows: readonly ForeignKeyRow[]): Map<string, ForeignKeyDefinition[]> {
  const grouped = groupBy(
    rows,
    (row) => `${tableKey(row.schemaName, row.tableName)}\u001e${row.constraintName}`,
  );
  const result = new Map<string, ForeignKeyDefinition[]>();

  for (const constraintRows of grouped.values()) {
    const ordered = [...constraintRows].sort(
      (left, right) => Number(left.ordinalPosition) - Number(right.ordinalPosition),
    );
    const first = ordered[0];
    if (!first) continue;
    const table = tableKey(first.schemaName, first.tableName);
    const definition: ForeignKeyDefinition = {
      name: first.constraintName,
      columns: ordered.map((row) => row.columnName),
      referencedCatalog: first.referencedSchemaName,
      referencedTable: first.referencedTableName,
      referencedColumns: ordered.map((row) => row.referencedColumnName),
      ...(first.updateRule ? { updateRule: first.updateRule } : {}),
      ...(first.deleteRule ? { deleteRule: first.deleteRule } : {}),
    };
    const existing = result.get(table) ?? [];
    existing.push(definition);
    result.set(table, existing);
  }

  return result;
}

function groupBy<T>(values: readonly T[], key: (value: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = result.get(groupKey);
    if (group) group.push(value);
    else result.set(groupKey, [value]);
  }
  return result;
}

function tableKey(catalog: string, table: string): string {
  return `${catalog}\u001f${table}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOkPacket(value: unknown): boolean {
  return isRecord(value) && ("affectedRows" in value || "insertId" in value || "warningCount" in value);
}

function numericProperty(value: Record<string, unknown>, key: string): number | undefined {
  return toOptionalNumber(value[key]);
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function numberOption(value: unknown, fallback: number): number {
  const number = toOptionalNumber(value);
  return number !== undefined ? number : fallback;
}

function booleanOption(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function compressionOption(value: unknown): "zlib" | "zstd" | "uncompressed" | ("zlib" | "zstd" | "uncompressed")[] | undefined {
  const allowed = new Set(["zlib", "zstd", "uncompressed"]);
  if (typeof value === "string" && allowed.has(value)) {
    return value as "zlib" | "zstd" | "uncompressed";
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string" && allowed.has(item))) {
    return value as ("zlib" | "zstd" | "uncompressed")[];
  }
  return undefined;
}

function isNamedValues(values: QueryRequest["values"]): boolean {
  return Boolean(values && !Array.isArray(values));
}

function mutableValues(values: NonNullable<QueryRequest["values"]>): unknown[] | Record<string, unknown> {
  return Array.isArray(values) ? [...values] : { ...values };
}

let sessionSequence = 0;
function createSessionId(): string {
  sessionSequence += 1;
  return `mysql-${Date.now().toString(36)}-${sessionSequence.toString(36)}`;
}

const SCHEMA_SQL = `
SELECT
  SCHEMA_NAME AS schemaName,
  DEFAULT_CHARACTER_SET_NAME AS defaultCharacterSet,
  DEFAULT_COLLATION_NAME AS defaultCollation
FROM INFORMATION_SCHEMA.SCHEMATA
ORDER BY SCHEMA_NAME`;

const TABLE_SQL = `
SELECT
  TABLE_SCHEMA AS schemaName,
  TABLE_NAME AS tableName,
  TABLE_TYPE AS tableType,
  ENGINE AS engine,
  TABLE_ROWS AS estimatedRows,
  TABLE_COMMENT AS comment
FROM INFORMATION_SCHEMA.TABLES
ORDER BY TABLE_SCHEMA, TABLE_NAME`;

const COLUMN_SQL = `
SELECT
  TABLE_SCHEMA AS schemaName,
  TABLE_NAME AS tableName,
  COLUMN_NAME AS columnName,
  ORDINAL_POSITION AS ordinalPosition,
  COLUMN_DEFAULT AS defaultValue,
  IS_NULLABLE AS isNullable,
  DATA_TYPE AS dataType,
  COLUMN_TYPE AS columnType,
  CHARACTER_MAXIMUM_LENGTH AS characterLength,
  NUMERIC_PRECISION AS numericPrecision,
  NUMERIC_SCALE AS numericScale,
  DATETIME_PRECISION AS datetimePrecision,
  EXTRA AS extra,
  COLUMN_COMMENT AS comment,
  GENERATION_EXPRESSION AS generationExpression
FROM INFORMATION_SCHEMA.COLUMNS
ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`;

const INDEX_SQL = `
SELECT
  TABLE_SCHEMA AS schemaName,
  TABLE_NAME AS tableName,
  INDEX_NAME AS indexName,
  NON_UNIQUE AS nonUnique,
  SEQ_IN_INDEX AS sequence,
  COLUMN_NAME AS columnName,
  COLLATION AS collation,
  INDEX_TYPE AS indexType,
  SUB_PART AS prefixLength
FROM INFORMATION_SCHEMA.STATISTICS
ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`;

const FOREIGN_KEY_SQL = `
SELECT
  kcu.TABLE_SCHEMA AS schemaName,
  kcu.TABLE_NAME AS tableName,
  kcu.CONSTRAINT_NAME AS constraintName,
  kcu.ORDINAL_POSITION AS ordinalPosition,
  kcu.COLUMN_NAME AS columnName,
  kcu.REFERENCED_TABLE_SCHEMA AS referencedSchemaName,
  kcu.REFERENCED_TABLE_NAME AS referencedTableName,
  kcu.REFERENCED_COLUMN_NAME AS referencedColumnName,
  rc.UPDATE_RULE AS updateRule,
  rc.DELETE_RULE AS deleteRule
FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc
  ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
 AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
WHERE kcu.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`;
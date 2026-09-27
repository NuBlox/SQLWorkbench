import mysql from "@nublox/mysql/promise";
import type {
  ColumnDefinition,
  DatabaseCatalog,
  DatabaseNamespace,
  DatabaseNamespaceReference,
  DatabaseNamespaceSummary,
  DatabaseObjectSummary,
  DatabasePrincipal,
  DatabasePrivilege,
  DatabaseSearchResult,
  EventDefinition,
  ForeignKeyDefinition,
  IndexColumnDefinition,
  IndexDefinition,
  RoleGrantDefinition,
  RoutineDefinition,
  TableDefinition,
  TriggerDefinition,
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
  ExplorerSearchRequest,
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
interface RoutineRow extends Row {
  schemaName: string;
  routineName: string;
  routineType: string;
  dataType: string | null;
  definition: string | null;
  securityType: string | null;
  sqlDataAccess: string | null;
  deterministic: string | null;
  createdAt: unknown;
  alteredAt: unknown;
  comment: string | null;
}
interface TriggerRow extends Row {
  schemaName: string;
  triggerName: string;
  tableName: string;
  eventName: string;
  timing: string;
  statement: string | null;
}
interface EventRow extends Row {
  schemaName: string;
  eventName: string;
  definition: string | null;
  scheduleType: string | null;
  executeAt: unknown;
  intervalValue: string | null;
  intervalField: string | null;
  startsAt: unknown;
  endsAt: unknown;
  status: string | null;
  onCompletion: string | null;
  comment: string | null;
}
interface PrivilegeRow extends Row {
  grantee: string;
  privilegeType: string;
  isGrantable: string;
  scope: "global" | "schema" | "table" | "column";
  schemaName: string | null;
  tableName: string | null;
  columnName: string | null;
}
interface RoleGrantRow extends Row {
  grantee: string;
  roleName: string;
  roleHost: string;
  isGrantable: string;
  isDefault: string | null;
}
interface SearchRow extends Row {
  schemaName: string;
  objectName: string;
  objectType: string;
  comment: string | null;
}
interface VersionRow extends Row { version: string; }

const SYSTEM_CATALOGS = new Set(["information_schema", "mysql", "performance_schema", "sys"]);

export const mysqlCapabilities: DatabaseCapabilities = Object.freeze({
  catalogIntrospection: true,
  schemas: false,
  views: true,
  indexes: true,
  foreignKeys: true,
  procedures: true,
  functions: true,
  triggers: true,
  events: true,
  partitions: false,
  transactions: true,
  savepoints: true,
  explainPlan: true,
  queryCancellation: true,
  objectSearch: true,
  privilegeIntrospection: true,
  serverAdministration: false,
  userAdministration: false,
});

export class MySqlDatabaseProvider implements DatabaseProvider {
  readonly id = "mysql";
  readonly displayName = "MySQL";
  readonly capabilities = mysqlCapabilities;
  readonly explorer: DatabaseExplorerProvider = new MySqlExplorerProvider();

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
    const [versionRows] = await mysqlSession.pool.query<VersionRow[]>("SELECT VERSION() AS version");
    const [schemaRows] = await mysqlSession.pool.query<SchemaRow[]>(SCHEMA_SQL);
    const [tableRows] = await mysqlSession.pool.query<TableRow[]>(TABLE_SQL);
    const [columnRows] = await mysqlSession.pool.query<ColumnRow[]>(COLUMN_SQL);
    const [indexRows] = await mysqlSession.pool.query<IndexRow[]>(INDEX_SQL);
    const [foreignKeyRows] = await mysqlSession.pool.query<ForeignKeyRow[]>(FOREIGN_KEY_SQL);

    const requestedCatalogs = options.catalogs?.length
      ? new Set(options.catalogs.map((value) => value.toLowerCase()))
      : undefined;
    const includeCatalog = (catalog: string): boolean => {
      if (requestedCatalogs && !requestedCatalogs.has(catalog.toLowerCase())) return false;
      return Boolean(options.includeSystem) || !SYSTEM_CATALOGS.has(catalog.toLowerCase());
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
        system: SYSTEM_CATALOGS.has(schema.schemaName.toLowerCase()),
        tables: (tablesBySchema.get(schema.schemaName) ?? []).map((table) =>
          mapTable(
            table,
            columnsByTable.get(tableKey(table.schemaName, table.tableName)) ?? [],
            indexesByTable.get(tableKey(table.schemaName, table.tableName)) ?? [],
            foreignKeysByTable.get(tableKey(table.schemaName, table.tableName)) ?? [],
          ),
        ),
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
    return { format: "mysql-json", raw: execution.resultSets };
  }

  quoteIdentifier(identifier: string): string {
    return `\`${identifier.replaceAll("`", "``")}\``;
  }
}

class MySqlExplorerProvider implements DatabaseExplorerProvider {
  async listNamespaces(
    session: DatabaseSession,
    options: ExplorerNamespaceOptions = {},
  ): Promise<readonly DatabaseNamespaceSummary[]> {
    const mysqlSession = requireMySqlSession(session);
    const [rows] = await mysqlSession.pool.query<SchemaRow[]>(SCHEMA_SQL);
    return rows
      .filter((row) => options.includeSystem || !SYSTEM_CATALOGS.has(row.schemaName.toLowerCase()))
      .map((row) => ({
        catalog: row.schemaName,
        defaultCharacterSet: row.defaultCharacterSet,
        defaultCollation: row.defaultCollation,
        system: SYSTEM_CATALOGS.has(row.schemaName.toLowerCase()),
      }));
  }

  async listObjects(
    session: DatabaseSession,
    namespace: DatabaseNamespaceReference,
  ): Promise<readonly DatabaseObjectSummary[]> {
    const catalog = requireCatalog(namespace);
    const mysqlSession = requireMySqlSession(session);
    const [rows] = await mysqlSession.pool.query<TableRow[]>({ sql: TABLE_FOR_SCHEMA_SQL, values: [catalog] });
    return rows.map((row) => ({
      catalog: row.schemaName,
      name: row.tableName,
      kind: row.tableType.toUpperCase() === "VIEW" ? "view" : "table",
      ...(row.comment ? { comment: row.comment } : {}),
    }));
  }

  async describeTable(session: DatabaseSession, object: ExplorerObjectReference): Promise<TableDefinition> {
    const catalog = requireCatalog(object);
    const name = requireName(object.name, "Object name");
    const mysqlSession = requireMySqlSession(session);
    const values = [catalog, name];
    const [[tables], [columns], [indexes], [foreignKeys]] = await Promise.all([
      mysqlSession.pool.query<TableRow[]>({ sql: TABLE_DETAIL_SQL, values }),
      mysqlSession.pool.query<ColumnRow[]>({ sql: COLUMN_DETAIL_SQL, values }),
      mysqlSession.pool.query<IndexRow[]>({ sql: INDEX_DETAIL_SQL, values }),
      mysqlSession.pool.query<ForeignKeyRow[]>({ sql: FOREIGN_KEY_DETAIL_SQL, values }),
    ]);
    const table = tables[0];
    if (!table) throw new Error(`MySQL object '${catalog}.${name}' does not exist or is not visible.`);
    return mapTable(table, columns, buildIndexes(indexes).get(tableKey(catalog, name)) ?? [], buildForeignKeys(foreignKeys).get(tableKey(catalog, name)) ?? []);
  }

  async listRoutines(session: DatabaseSession, namespace: DatabaseNamespaceReference): Promise<readonly RoutineDefinition[]> {
    const catalog = requireCatalog(namespace);
    const mysqlSession = requireMySqlSession(session);
    const [rows] = await mysqlSession.pool.query<RoutineRow[]>({ sql: ROUTINE_SQL, values: [catalog] });
    return rows.map((row) => ({
      catalog: row.schemaName,
      name: row.routineName,
      kind: row.routineType.toUpperCase() === "FUNCTION" ? "function" : "procedure",
      ...(row.dataType ? { dataType: row.dataType } : {}),
      ...(row.definition ? { definition: row.definition } : {}),
      ...(row.securityType ? { securityType: row.securityType } : {}),
      ...(row.sqlDataAccess ? { sqlDataAccess: row.sqlDataAccess } : {}),
      ...(row.deterministic ? { deterministic: row.deterministic.toUpperCase() === "YES" } : {}),
      ...(toIsoString(row.createdAt) ? { createdAt: toIsoString(row.createdAt)! } : {}),
      ...(toIsoString(row.alteredAt) ? { alteredAt: toIsoString(row.alteredAt)! } : {}),
      ...(row.comment ? { comment: row.comment } : {}),
    }));
  }

  async listTriggers(session: DatabaseSession, namespace: DatabaseNamespaceReference): Promise<readonly TriggerDefinition[]> {
    const catalog = requireCatalog(namespace);
    const mysqlSession = requireMySqlSession(session);
    const [rows] = await mysqlSession.pool.query<TriggerRow[]>({ sql: TRIGGER_SQL, values: [catalog] });
    return rows.map((row) => ({
      catalog: row.schemaName,
      name: row.triggerName,
      kind: "trigger",
      table: row.tableName,
      event: row.eventName,
      timing: row.timing,
      ...(row.statement ? { statement: row.statement } : {}),
    }));
  }

  async listEvents(session: DatabaseSession, namespace: DatabaseNamespaceReference): Promise<readonly EventDefinition[]> {
    const catalog = requireCatalog(namespace);
    const mysqlSession = requireMySqlSession(session);
    const [rows] = await mysqlSession.pool.query<EventRow[]>({ sql: EVENT_SQL, values: [catalog] });
    return rows.map((row) => ({
      catalog: row.schemaName,
      name: row.eventName,
      kind: "event",
      ...(row.definition ? { definition: row.definition } : {}),
      ...(row.scheduleType ? { scheduleType: row.scheduleType } : {}),
      ...(toIsoString(row.executeAt) ? { executeAt: toIsoString(row.executeAt)! } : {}),
      ...(row.intervalValue ? { intervalValue: row.intervalValue } : {}),
      ...(row.intervalField ? { intervalField: row.intervalField } : {}),
      ...(toIsoString(row.startsAt) ? { startsAt: toIsoString(row.startsAt)! } : {}),
      ...(toIsoString(row.endsAt) ? { endsAt: toIsoString(row.endsAt)! } : {}),
      ...(row.status ? { status: row.status } : {}),
      ...(row.onCompletion ? { onCompletion: row.onCompletion } : {}),
      ...(row.comment ? { comment: row.comment } : {}),
    }));
  }

  async listPrincipals(session: DatabaseSession): Promise<readonly DatabasePrincipal[]> {
    const privileges = await this.listPrivileges(session);
    const roleGrants = await this.listRoleGrants(session);
    const roleSet = new Set(roleGrants.map((grant) => grant.role));
    const grantees = new Set<string>([
      ...privileges.map((item) => item.grantee),
      ...roleGrants.flatMap((item) => [item.grantee, item.role]),
    ]);
    return [...grantees].sort().map((grantee) => {
      const parsed = parseGrantee(grantee);
      return {
        grantee,
        name: parsed.name,
        ...(parsed.host ? { host: parsed.host } : {}),
        kind: roleSet.has(grantee) ? "role" : "user",
      };
    });
  }

  async listRoleGrants(session: DatabaseSession): Promise<readonly RoleGrantDefinition[]> {
    const mysqlSession = requireMySqlSession(session);
    try {
      const [rows] = await mysqlSession.pool.query<RoleGrantRow[]>(ROLE_GRANT_SQL);
      return rows.map((row) => ({
        grantee: row.grantee,
        role: formatGrantee(row.roleName, row.roleHost),
        grantable: row.isGrantable.toUpperCase() === "YES",
        ...(row.isDefault ? { defaultRole: row.isDefault.toUpperCase() === "YES" } : {}),
      }));
    } catch {
      return [];
    }
  }

  async listPrivileges(session: DatabaseSession, grantee?: string): Promise<readonly DatabasePrivilege[]> {
    const mysqlSession = requireMySqlSession(session);
    const [rows] = await mysqlSession.pool.query<PrivilegeRow[]>(PRIVILEGE_SQL);
    return rows
      .filter((row) => !grantee || row.grantee === grantee)
      .map((row) => ({
        grantee: row.grantee,
        privilege: row.privilegeType,
        scope: row.scope,
        ...(row.schemaName ? { catalog: row.schemaName } : {}),
        ...(row.tableName ? { table: row.tableName } : {}),
        ...(row.columnName ? { column: row.columnName } : {}),
        grantable: row.isGrantable.toUpperCase() === "YES",
      }));
  }

  async search(session: DatabaseSession, request: ExplorerSearchRequest): Promise<readonly DatabaseSearchResult[]> {
    const term = requireName(request.term, "Search term");
    const mysqlSession = requireMySqlSession(session);
    const pattern = `%${term}%`;
    const [rows] = await mysqlSession.pool.query<SearchRow[]>({
      sql: SEARCH_SQL,
      values: [pattern, pattern, pattern, pattern],
    });
    const catalog = request.namespace?.catalog?.toLowerCase();
    const limit = Math.min(Math.max(request.limit ?? 100, 1), 500);
    return rows
      .filter((row) => !catalog || row.schemaName.toLowerCase() === catalog)
      .slice(0, limit)
      .map((row) => ({
        catalog: row.schemaName,
        name: row.objectName,
        kind: searchKind(row.objectType),
        ...(row.comment ? { comment: row.comment } : {}),
      }));
  }
}

class MySqlSession implements DatabaseSession {
  readonly providerId = "mysql";
  readonly connectedAt = new Date().toISOString();
  constructor(readonly id: string, readonly pool: MySqlPool, readonly host: string) {}
  async health(): Promise<SessionHealth> {
    const result = await this.pool.healthCheck();
    return {
      ok: result.ok,
      latencyMs: result.latencyMs,
      ...(result.errorCode ? { message: result.errorCode } : {}),
    };
  }
  close(): Promise<void> { return this.pool.end(); }
}

function requireMySqlSession(session: DatabaseSession): MySqlSession {
  if (!(session instanceof MySqlSession)) throw new Error("Session was not created by the MySQL provider.");
  return session;
}

function requireCatalog(namespace: DatabaseNamespaceReference): string {
  return requireName(namespace.catalog ?? namespace.schema ?? "", "Catalog");
}
function requireName(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} cannot be empty.`);
  return result;
}

function mapTable(table: TableRow, columns: readonly ColumnRow[], indexes: readonly IndexDefinition[], foreignKeys: readonly ForeignKeyDefinition[]): TableDefinition {
  const estimatedRows = toOptionalNumber(table.estimatedRows);
  return {
    catalog: table.schemaName,
    name: table.tableName,
    kind: table.tableType.toUpperCase() === "VIEW" ? "view" : "table",
    ...(table.engine ? { engine: table.engine } : {}),
    ...(estimatedRows !== undefined ? { estimatedRows } : {}),
    ...(table.comment ? { comment: table.comment } : {}),
    columns: [...columns].sort((left, right) => Number(left.ordinalPosition) - Number(right.ordinalPosition)).map(mapColumn),
    indexes,
    foreignKeys,
  };
}

function normalizeResults(result: unknown, fields: unknown): QueryResultSet[] {
  if (Array.isArray(result) && result.some((item) => Array.isArray(item) || isOkPacket(item))) {
    const fieldSets = Array.isArray(fields) ? fields : [];
    return result.map((item, index) => normalizeSingleResult(item, fieldSets[index]));
  }
  return [normalizeSingleResult(result, fields)];
}
function normalizeSingleResult(result: unknown, fields: unknown): QueryResultSet {
  if (Array.isArray(result)) return { columns: normalizeColumns(fields), rows: result.filter(isRecord) };
  if (isRecord(result)) {
    const affectedRows = numericProperty(result, "affectedRows");
    const changedRows = numericProperty(result, "changedRows");
    const insertId = numericProperty(result, "insertId");
    const warningCount = numericProperty(result, "warningCount");
    return {
      columns: [], rows: [],
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
  const grouped = groupBy(rows, (row) => `${tableKey(row.schemaName, row.tableName)}\u001e${row.constraintName}`);
  const result = new Map<string, ForeignKeyDefinition[]>();
  for (const constraintRows of grouped.values()) {
    const ordered = [...constraintRows].sort((left, right) => Number(left.ordinalPosition) - Number(right.ordinalPosition));
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
    if (group) group.push(value); else result.set(groupKey, [value]);
  }
  return result;
}
function tableKey(catalog: string, table: string): string { return `${catalog}\u001f${table}`; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isOkPacket(value: unknown): boolean { return isRecord(value) && ("affectedRows" in value || "insertId" in value || "warningCount" in value); }
function numericProperty(value: Record<string, unknown>, key: string): number | undefined { return toOptionalNumber(value[key]); }
function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
function toIsoString(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
function numberOption(value: unknown, fallback: number): number { return toOptionalNumber(value) ?? fallback; }
function booleanOption(value: unknown, fallback: boolean): boolean { return typeof value === "boolean" ? value : fallback; }
function compressionOption(value: unknown): "zlib" | "zstd" | "uncompressed" | ("zlib" | "zstd" | "uncompressed")[] | undefined {
  const allowed = new Set(["zlib", "zstd", "uncompressed"]);
  if (typeof value === "string" && allowed.has(value)) return value as "zlib" | "zstd" | "uncompressed";
  if (Array.isArray(value) && value.every((item) => typeof item === "string" && allowed.has(item))) return value as ("zlib" | "zstd" | "uncompressed")[];
  return undefined;
}
function isNamedValues(values: QueryRequest["values"]): boolean { return Boolean(values && !Array.isArray(values)); }
function mutableValues(values: NonNullable<QueryRequest["values"]>): unknown[] | Record<string, unknown> { return Array.isArray(values) ? [...values] : { ...values }; }
function parseGrantee(value: string): { name: string; host?: string } {
  const match = /^'((?:''|[^'])*)'@'((?:''|[^'])*)'$/.exec(value);
  if (!match) return { name: value };
  return { name: match[1]!.replaceAll("''", "'"), host: match[2]!.replaceAll("''", "'") };
}
function formatGrantee(name: string, host: string): string { return `'${name.replaceAll("'", "''")}'@'${host.replaceAll("'", "''")}'`; }
function searchKind(value: string): DatabaseSearchResult["kind"] {
  const upper = value.toUpperCase();
  if (upper === "VIEW") return "view";
  if (upper === "PROCEDURE") return "procedure";
  if (upper === "FUNCTION") return "function";
  if (upper === "TRIGGER") return "trigger";
  if (upper === "EVENT") return "event";
  return "table";
}
let sessionSequence = 0;
function createSessionId(): string { sessionSequence += 1; return `mysql-${Date.now().toString(36)}-${sessionSequence.toString(36)}`; }

const SCHEMA_SQL = `SELECT SCHEMA_NAME AS schemaName, DEFAULT_CHARACTER_SET_NAME AS defaultCharacterSet, DEFAULT_COLLATION_NAME AS defaultCollation FROM INFORMATION_SCHEMA.SCHEMATA ORDER BY SCHEMA_NAME`;
const TABLE_SQL = `SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS tableName, TABLE_TYPE AS tableType, ENGINE AS engine, TABLE_ROWS AS estimatedRows, TABLE_COMMENT AS comment FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_SCHEMA, TABLE_NAME`;
const TABLE_FOR_SCHEMA_SQL = `${TABLE_SQL.replace(" ORDER BY TABLE_SCHEMA, TABLE_NAME", "")} WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`;
const TABLE_DETAIL_SQL = `${TABLE_SQL.replace(" ORDER BY TABLE_SCHEMA, TABLE_NAME", "")} WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`;
const COLUMN_SQL = `SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS tableName, COLUMN_NAME AS columnName, ORDINAL_POSITION AS ordinalPosition, COLUMN_DEFAULT AS defaultValue, IS_NULLABLE AS isNullable, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, CHARACTER_MAXIMUM_LENGTH AS characterLength, NUMERIC_PRECISION AS numericPrecision, NUMERIC_SCALE AS numericScale, DATETIME_PRECISION AS datetimePrecision, EXTRA AS extra, COLUMN_COMMENT AS comment, GENERATION_EXPRESSION AS generationExpression FROM INFORMATION_SCHEMA.COLUMNS ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`;
const COLUMN_DETAIL_SQL = `SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS tableName, COLUMN_NAME AS columnName, ORDINAL_POSITION AS ordinalPosition, COLUMN_DEFAULT AS defaultValue, IS_NULLABLE AS isNullable, DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, CHARACTER_MAXIMUM_LENGTH AS characterLength, NUMERIC_PRECISION AS numericPrecision, NUMERIC_SCALE AS numericScale, DATETIME_PRECISION AS datetimePrecision, EXTRA AS extra, COLUMN_COMMENT AS comment, GENERATION_EXPRESSION AS generationExpression FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`;
const INDEX_SQL = `SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequence, COLUMN_NAME AS columnName, COLLATION AS collation, INDEX_TYPE AS indexType, SUB_PART AS prefixLength FROM INFORMATION_SCHEMA.STATISTICS ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`;
const INDEX_DETAIL_SQL = `SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique, SEQ_IN_INDEX AS sequence, COLUMN_NAME AS columnName, COLLATION AS collation, INDEX_TYPE AS indexType, SUB_PART AS prefixLength FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX`;
const FOREIGN_KEY_SQL = `SELECT kcu.TABLE_SCHEMA AS schemaName, kcu.TABLE_NAME AS tableName, kcu.CONSTRAINT_NAME AS constraintName, kcu.ORDINAL_POSITION AS ordinalPosition, kcu.COLUMN_NAME AS columnName, kcu.REFERENCED_TABLE_SCHEMA AS referencedSchemaName, kcu.REFERENCED_TABLE_NAME AS referencedTableName, kcu.REFERENCED_COLUMN_NAME AS referencedColumnName, rc.UPDATE_RULE AS updateRule, rc.DELETE_RULE AS deleteRule FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME WHERE kcu.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY kcu.TABLE_SCHEMA, kcu.TABLE_NAME, kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`;
const FOREIGN_KEY_DETAIL_SQL = `SELECT kcu.TABLE_SCHEMA AS schemaName, kcu.TABLE_NAME AS tableName, kcu.CONSTRAINT_NAME AS constraintName, kcu.ORDINAL_POSITION AS ordinalPosition, kcu.COLUMN_NAME AS columnName, kcu.REFERENCED_TABLE_SCHEMA AS referencedSchemaName, kcu.REFERENCED_TABLE_NAME AS referencedTableName, kcu.REFERENCED_COLUMN_NAME AS referencedColumnName, rc.UPDATE_RULE AS updateRule, rc.DELETE_RULE AS deleteRule FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu JOIN INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS rc ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME WHERE kcu.REFERENCED_TABLE_NAME IS NOT NULL AND kcu.TABLE_SCHEMA = ? AND kcu.TABLE_NAME = ? ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION`;
const ROUTINE_SQL = `SELECT ROUTINE_SCHEMA AS schemaName, ROUTINE_NAME AS routineName, ROUTINE_TYPE AS routineType, DATA_TYPE AS dataType, ROUTINE_DEFINITION AS definition, SECURITY_TYPE AS securityType, SQL_DATA_ACCESS AS sqlDataAccess, IS_DETERMINISTIC AS deterministic, CREATED AS createdAt, LAST_ALTERED AS alteredAt, ROUTINE_COMMENT AS comment FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_TYPE, ROUTINE_NAME`;
const TRIGGER_SQL = `SELECT TRIGGER_SCHEMA AS schemaName, TRIGGER_NAME AS triggerName, EVENT_OBJECT_TABLE AS tableName, EVENT_MANIPULATION AS eventName, ACTION_TIMING AS timing, ACTION_STATEMENT AS statement FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME`;
const EVENT_SQL = `SELECT EVENT_SCHEMA AS schemaName, EVENT_NAME AS eventName, EVENT_DEFINITION AS definition, EVENT_TYPE AS scheduleType, EXECUTE_AT AS executeAt, INTERVAL_VALUE AS intervalValue, INTERVAL_FIELD AS intervalField, STARTS AS startsAt, ENDS AS endsAt, STATUS AS status, ON_COMPLETION AS onCompletion, EVENT_COMMENT AS comment FROM INFORMATION_SCHEMA.EVENTS WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME`;
const PRIVILEGE_SQL = `SELECT GRANTEE AS grantee, PRIVILEGE_TYPE AS privilegeType, IS_GRANTABLE AS isGrantable, 'global' AS scope, NULL AS schemaName, NULL AS tableName, NULL AS columnName FROM INFORMATION_SCHEMA.USER_PRIVILEGES UNION ALL SELECT GRANTEE, PRIVILEGE_TYPE, IS_GRANTABLE, 'schema', TABLE_SCHEMA, NULL, NULL FROM INFORMATION_SCHEMA.SCHEMA_PRIVILEGES UNION ALL SELECT GRANTEE, PRIVILEGE_TYPE, IS_GRANTABLE, 'table', TABLE_SCHEMA, TABLE_NAME, NULL FROM INFORMATION_SCHEMA.TABLE_PRIVILEGES UNION ALL SELECT GRANTEE, PRIVILEGE_TYPE, IS_GRANTABLE, 'column', TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMN_PRIVILEGES ORDER BY grantee, scope, schemaName, tableName, columnName, privilegeType`;
const ROLE_GRANT_SQL = `SELECT GRANTEE AS grantee, ROLE_NAME AS roleName, ROLE_HOST AS roleHost, IS_GRANTABLE AS isGrantable, IS_DEFAULT AS isDefault FROM INFORMATION_SCHEMA.APPLICABLE_ROLES ORDER BY GRANTEE, ROLE_NAME, ROLE_HOST`;
const SEARCH_SQL = `SELECT TABLE_SCHEMA AS schemaName, TABLE_NAME AS objectName, TABLE_TYPE AS objectType, TABLE_COMMENT AS comment FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE ? UNION ALL SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ROUTINE_TYPE, ROUTINE_COMMENT FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_NAME LIKE ? UNION ALL SELECT TRIGGER_SCHEMA, TRIGGER_NAME, 'TRIGGER', NULL FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_NAME LIKE ? UNION ALL SELECT EVENT_SCHEMA, EVENT_NAME, 'EVENT', EVENT_COMMENT FROM INFORMATION_SCHEMA.EVENTS WHERE EVENT_NAME LIKE ? ORDER BY schemaName, objectType, objectName`;

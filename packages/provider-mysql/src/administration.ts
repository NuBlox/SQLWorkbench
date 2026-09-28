import type {
  DatabaseAdministrationCapabilities,
  DatabaseAdministrationPreview,
  DatabaseAdministrationProvider,
  DatabaseDataWriteResult,
  DatabaseExternalConnection,
  DatabaseExternalToolPlan,
  DatabaseLockWait,
  DatabaseRoleMembership,
  DatabaseSecurityChange,
  DatabaseSecurityPrincipal,
  DatabaseSecurityPrivilege,
  DatabaseServerSession,
  DatabaseServerStatus,
  DatabaseServerVariable,
  DatabaseSession,
  DatabaseStorageEntry,
  DatabaseTableReadRequest,
  DatabaseTableWriteRequest,
  QueryExecution,
  QueryResultSet,
} from "@nublox/workbench-provider-api";

import type { MySqlDatabaseProvider } from "./index.js";

const PROCESSLIST_SQL = `SELECT
  ID AS sessionId,
  USER AS userName,
  HOST AS hostName,
  DB AS databaseName,
  COMMAND AS commandName,
  TIME AS timeSeconds,
  STATE AS stateName,
  INFO AS statementText
FROM INFORMATION_SCHEMA.PROCESSLIST
ORDER BY TIME DESC, ID ASC`;

const LOCK_WAITS_SQL = `SELECT
  waiting_thread.PROCESSLIST_ID AS waitingSessionId,
  blocking_thread.PROCESSLIST_ID AS blockingSessionId,
  CONCAT_WS('.', requested.OBJECT_SCHEMA, requested.OBJECT_NAME) AS objectName,
  requested.LOCK_TYPE AS lockType,
  requested.LOCK_MODE AS lockMode,
  TIMESTAMPDIFF(SECOND, waiting_trx.TRX_WAIT_STARTED, CURRENT_TIMESTAMP()) AS waitSeconds,
  COALESCE(waiting_statement.SQL_TEXT, waiting_trx.TRX_QUERY) AS statementText
FROM performance_schema.data_lock_waits AS waits
JOIN performance_schema.data_locks AS requested
  ON requested.ENGINE = waits.ENGINE
 AND requested.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
JOIN performance_schema.threads AS waiting_thread
  ON waiting_thread.THREAD_ID = waits.REQUESTING_THREAD_ID
LEFT JOIN performance_schema.threads AS blocking_thread
  ON blocking_thread.THREAD_ID = waits.BLOCKING_THREAD_ID
LEFT JOIN INFORMATION_SCHEMA.INNODB_TRX AS waiting_trx
  ON waiting_trx.TRX_MYSQL_THREAD_ID = waiting_thread.PROCESSLIST_ID
LEFT JOIN performance_schema.events_statements_current AS waiting_statement
  ON waiting_statement.THREAD_ID = waits.REQUESTING_THREAD_ID
WHERE waiting_thread.PROCESSLIST_ID IS NOT NULL
ORDER BY waitSeconds DESC, waiting_thread.PROCESSLIST_ID, blocking_thread.PROCESSLIST_ID`;

const SECURITY_PRINCIPALS_SQL = `SELECT
  user.User AS userName,
  user.Host AS hostName,
  user.account_locked AS accountLocked,
  user.password_expired AS passwordExpired,
  user.plugin AS authenticationPlugin,
  CASE WHEN roles.TO_USER IS NULL THEN 'user' ELSE 'role' END AS principalKind
FROM mysql.user AS user
LEFT JOIN (
  SELECT DISTINCT TO_USER, TO_HOST FROM mysql.role_edges
) AS roles
  ON roles.TO_USER = user.User AND roles.TO_HOST = user.Host
ORDER BY principalKind DESC, user.User, user.Host`;

const ROLE_MEMBERSHIPS_SQL = `SELECT
  edge.FROM_USER AS roleName,
  edge.FROM_HOST AS roleHost,
  edge.TO_USER AS granteeName,
  edge.TO_HOST AS granteeHost,
  edge.WITH_ADMIN_OPTION AS adminOption,
  CASE WHEN defaults.DEFAULT_ROLE_USER IS NULL THEN 'N' ELSE 'Y' END AS defaultRole
FROM mysql.role_edges AS edge
LEFT JOIN mysql.default_roles AS defaults
  ON defaults.USER = edge.TO_USER
 AND defaults.HOST = edge.TO_HOST
 AND defaults.DEFAULT_ROLE_USER = edge.FROM_USER
 AND defaults.DEFAULT_ROLE_HOST = edge.FROM_HOST
ORDER BY edge.TO_USER, edge.TO_HOST, edge.FROM_USER, edge.FROM_HOST`;

const SECURITY_PRIVILEGES_SQL = `SELECT GRANTEE AS grantee, PRIVILEGE_TYPE AS privilegeType, 'global' AS scopeName, NULL AS schemaName, NULL AS tableName, NULL AS columnName, IS_GRANTABLE AS isGrantable FROM INFORMATION_SCHEMA.USER_PRIVILEGES
UNION ALL
SELECT GRANTEE, PRIVILEGE_TYPE, 'schema', TABLE_SCHEMA, NULL, NULL, IS_GRANTABLE FROM INFORMATION_SCHEMA.SCHEMA_PRIVILEGES
UNION ALL
SELECT GRANTEE, PRIVILEGE_TYPE, 'table', TABLE_SCHEMA, TABLE_NAME, NULL, IS_GRANTABLE FROM INFORMATION_SCHEMA.TABLE_PRIVILEGES
UNION ALL
SELECT GRANTEE, PRIVILEGE_TYPE, 'column', TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, IS_GRANTABLE FROM INFORMATION_SCHEMA.COLUMN_PRIVILEGES
ORDER BY grantee, scopeName, schemaName, tableName, columnName, privilegeType`;

const STORAGE_SQL = `SELECT
  TABLE_SCHEMA AS catalogName,
  TABLE_NAME AS tableName,
  ENGINE AS engineName,
  TABLE_ROWS AS estimatedRows,
  COALESCE(DATA_LENGTH, 0) AS dataBytes,
  COALESCE(INDEX_LENGTH, 0) AS indexBytes,
  COALESCE(DATA_FREE, 0) AS freeBytes
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE'
  AND TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
ORDER BY TABLE_SCHEMA, TABLE_NAME`;

export const mysqlAdministrationCapabilities: DatabaseAdministrationCapabilities = Object.freeze({
  sessions: true,
  locks: true,
  serverVariables: true,
  serverStatus: true,
  users: true,
  storage: true,
  importExport: true,
  backupRestore: true,
  dataTransfer: true,
});

export class MySqlAdministrationProvider implements DatabaseAdministrationProvider {
  readonly providerId = "mysql";
  readonly capabilities = mysqlAdministrationCapabilities;

  constructor(private readonly provider: Pick<MySqlDatabaseProvider, "execute" | "quoteIdentifier">) {}

  async listSessions(session: DatabaseSession): Promise<readonly DatabaseServerSession[]> {
    const rows = await this.#rows(session, PROCESSLIST_SQL);
    return rows.map((row) => ({
      id: stringValue(row.sessionId),
      user: stringValue(row.userName),
      ...(optionalString(row.hostName) ? { host: optionalString(row.hostName)! } : {}),
      ...(optionalString(row.databaseName) ? { database: optionalString(row.databaseName)! } : {}),
      command: stringValue(row.commandName),
      timeSeconds: finiteNumber(row.timeSeconds),
      ...(optionalString(row.stateName) ? { state: optionalString(row.stateName)! } : {}),
      ...(optionalString(row.statementText) ? { statement: optionalString(row.statementText)! } : {}),
    }));
  }

  async listLockWaits(session: DatabaseSession): Promise<readonly DatabaseLockWait[]> {
    const rows = await this.#rows(session, LOCK_WAITS_SQL);
    return rows.map((row) => ({
      waitingSessionId: stringValue(row.waitingSessionId),
      ...(optionalString(row.blockingSessionId) ? { blockingSessionId: optionalString(row.blockingSessionId)! } : {}),
      ...(optionalString(row.objectName) ? { object: optionalString(row.objectName)! } : {}),
      ...(optionalString(row.lockType) ? { lockType: optionalString(row.lockType)! } : {}),
      ...(optionalString(row.lockMode) ? { lockMode: optionalString(row.lockMode)! } : {}),
      ...(optionalFiniteNumber(row.waitSeconds) !== undefined ? { waitSeconds: optionalFiniteNumber(row.waitSeconds)! } : {}),
      ...(optionalString(row.statementText) ? { statement: optionalString(row.statementText)! } : {}),
    }));
  }

  async listServerVariables(session: DatabaseSession, filter?: string): Promise<readonly DatabaseServerVariable[]> {
    const rows = await this.#rows(session, "SHOW GLOBAL VARIABLES");
    return filterNamedValues(rows.map((row) => ({
      name: stringValue(row.Variable_name ?? row.variable_name ?? row.name),
      value: stringValue(row.Value ?? row.value),
    })), filter);
  }

  async listServerStatus(session: DatabaseSession, filter?: string): Promise<readonly DatabaseServerStatus[]> {
    const rows = await this.#rows(session, "SHOW GLOBAL STATUS");
    return filterNamedValues(rows.map((row) => ({
      name: stringValue(row.Variable_name ?? row.variable_name ?? row.name),
      value: stringValue(row.Value ?? row.value),
    })), filter);
  }

  async listSecurityPrincipals(session: DatabaseSession): Promise<readonly DatabaseSecurityPrincipal[]> {
    const rows = await this.#rows(session, SECURITY_PRINCIPALS_SQL);
    return rows.map((row) => ({
      grantee: formatAccount(stringValue(row.userName), stringValue(row.hostName)),
      name: stringValue(row.userName),
      host: stringValue(row.hostName),
      kind: stringValue(row.principalKind) === "role" ? "role" : "user",
      accountLocked: yesNo(row.accountLocked),
      passwordExpired: yesNo(row.passwordExpired),
      ...(optionalString(row.authenticationPlugin) ? { authenticationPlugin: optionalString(row.authenticationPlugin)! } : {}),
    }));
  }

  async listSecurityPrivileges(session: DatabaseSession, grantee?: string): Promise<readonly DatabaseSecurityPrivilege[]> {
    const rows = await this.#rows(session, SECURITY_PRIVILEGES_SQL);
    return rows.filter((row) => !grantee || stringValue(row.grantee) === grantee).map((row) => ({
      grantee: stringValue(row.grantee),
      privilege: stringValue(row.privilegeType),
      scope: securityScope(row.scopeName),
      ...(optionalString(row.schemaName) ? { catalog: optionalString(row.schemaName)! } : {}),
      ...(optionalString(row.tableName) ? { table: optionalString(row.tableName)! } : {}),
      ...(optionalString(row.columnName) ? { column: optionalString(row.columnName)! } : {}),
      grantable: yesNo(row.isGrantable),
    }));
  }

  async listRoleMemberships(session: DatabaseSession): Promise<readonly DatabaseRoleMembership[]> {
    try {
      const rows = await this.#rows(session, ROLE_MEMBERSHIPS_SQL);
      return rows.map((row) => ({
        grantee: formatAccount(stringValue(row.granteeName), stringValue(row.granteeHost)),
        role: formatAccount(stringValue(row.roleName), stringValue(row.roleHost)),
        grantable: yesNo(row.adminOption),
        defaultRole: yesNo(row.defaultRole),
      }));
    } catch {
      return [];
    }
  }

  previewSecurityChange(change: DatabaseSecurityChange): DatabaseAdministrationPreview {
    const statement = securityStatement(change, (value) => this.provider.quoteIdentifier(value));
    const destructive = change.kind === "drop-role" || change.kind === "revoke-role" || change.kind === "revoke-privileges";
    return {
      providerId: this.providerId,
      statements: [statement],
      destructive,
      warnings: destructive ? ["This change removes an existing authorization relationship or privilege."] : [],
    };
  }

  async applySecurityChange(session: DatabaseSession, change: DatabaseSecurityChange): Promise<void> {
    const preview = this.previewSecurityChange(change);
    for (const statement of preview.statements) await this.provider.execute(session, { sql: statement, mode: "text" });
  }

  async listStorage(session: DatabaseSession): Promise<readonly DatabaseStorageEntry[]> {
    const rows = await this.#rows(session, STORAGE_SQL);
    return rows.map((row) => {
      const dataBytes = finiteNumber(row.dataBytes);
      const indexBytes = finiteNumber(row.indexBytes);
      const freeBytes = finiteNumber(row.freeBytes);
      return {
        catalog: stringValue(row.catalogName),
        table: stringValue(row.tableName),
        ...(optionalString(row.engineName) ? { engine: optionalString(row.engineName)! } : {}),
        ...(optionalFiniteNumber(row.estimatedRows) !== undefined ? { estimatedRows: optionalFiniteNumber(row.estimatedRows)! } : {}),
        dataBytes,
        indexBytes,
        freeBytes,
        totalBytes: dataBytes + indexBytes,
      };
    });
  }

  async readTableRows(session: DatabaseSession, request: DatabaseTableReadRequest): Promise<QueryResultSet> {
    const catalog = requireIdentifier(request.catalog, "Catalog");
    const table = requireIdentifier(request.table, "Table");
    const limit = boundedRows(request.limit);
    const sql = `SELECT * FROM ${this.provider.quoteIdentifier(catalog)}.${this.provider.quoteIdentifier(table)} LIMIT ${limit}`;
    const execution = await this.provider.execute(session, { sql, mode: "text" });
    return execution.resultSets[0] ?? { columns: [], rows: [] };
  }

  async writeTableRows(session: DatabaseSession, request: DatabaseTableWriteRequest): Promise<DatabaseDataWriteResult> {
    const catalog = requireIdentifier(request.catalog, "Catalog");
    const table = requireIdentifier(request.table, "Table");
    if (request.rows.length > 10_000) throw new Error("A single data-write operation cannot exceed 10,000 rows.");
    if (request.rows.length === 0) return { rowsAttempted: 0, rowsWritten: 0 };
    const columns = Object.keys(request.rows[0] ?? {});
    if (columns.length === 0) throw new Error("Data rows must contain at least one column.");
    for (const row of request.rows) {
      const rowColumns = Object.keys(row);
      if (rowColumns.length !== columns.length || rowColumns.some((column, index) => column !== columns[index])) {
        throw new Error("All imported/transferred rows must use the same ordered column set.");
      }
    }
    const sql = `INSERT INTO ${this.provider.quoteIdentifier(catalog)}.${this.provider.quoteIdentifier(table)} (${columns.map((column) => this.provider.quoteIdentifier(column)).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
    let rowsWritten = 0;
    for (const row of request.rows) {
      const execution = await this.provider.execute(session, { sql, mode: "prepared", values: columns.map((column) => row[column]) });
      rowsWritten += execution.resultSets[0]?.affectedRows ?? 0;
    }
    return { rowsAttempted: request.rows.length, rowsWritten };
  }

  createBackupPlan(connection: DatabaseExternalConnection, catalog: string): DatabaseExternalToolPlan {
    const database = requireIdentifier(catalog, "Catalog");
    return {
      executable: "mysqldump",
      args: connectionArgs(connection, true).concat(["--single-transaction", "--routines", "--triggers", "--events", "--databases", database]),
      direction: "stdout-to-file",
      passwordEnvironmentVariable: "MYSQL_PWD",
      destructive: false,
      warnings: ["The mysqldump executable must be installed and available on PATH."],
    };
  }

  createRestorePlan(connection: DatabaseExternalConnection, catalog: string): DatabaseExternalToolPlan {
    const database = requireIdentifier(catalog, "Catalog");
    return {
      executable: "mysql",
      args: connectionArgs(connection, false).concat([database]),
      direction: "file-to-stdin",
      passwordEnvironmentVariable: "MYSQL_PWD",
      destructive: true,
      warnings: ["Restoring SQL can overwrite or delete existing database objects and data.", "The mysql client executable must be installed and available on PATH."],
    };
  }

  async #rows(session: DatabaseSession, sql: string): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const execution: QueryExecution = await this.provider.execute(session, { sql, mode: "text" });
    return execution.resultSets[0]?.rows ?? [];
  }
}

function securityStatement(change: DatabaseSecurityChange, quoteIdentifier: (value: string) => string): string {
  if (change.kind === "create-role") return `CREATE ROLE IF NOT EXISTS ${quoteAccount(change.role)}`;
  if (change.kind === "drop-role") return `DROP ROLE IF EXISTS ${quoteAccount(change.role)}`;
  if (change.kind === "grant-role") return `GRANT ${quoteAccount(change.role)} TO ${quoteAccount(change.grantee)}${change.adminOption ? " WITH ADMIN OPTION" : ""}`;
  if (change.kind === "revoke-role") return `REVOKE ${quoteAccount(change.role)} FROM ${quoteAccount(change.grantee)}`;
  const privileges = normalizePrivileges(change.privileges).join(", ");
  const target = scopeTarget(change.scope, change.catalog, change.table, quoteIdentifier);
  if (change.kind === "grant-privileges") return `GRANT ${privileges} ON ${target} TO ${quoteAccount(change.grantee)}${change.grantOption ? " WITH GRANT OPTION" : ""}`;
  return `REVOKE ${privileges} ON ${target} FROM ${quoteAccount(change.grantee)}`;
}

function scopeTarget(scope: "global" | "schema" | "table", catalog: string | undefined, table: string | undefined, quoteIdentifier: (value: string) => string): string {
  if (scope === "global") return "*.*";
  const database = requireIdentifier(catalog ?? "", "Catalog");
  if (scope === "schema") return `${quoteIdentifier(database)}.*`;
  return `${quoteIdentifier(database)}.${quoteIdentifier(requireIdentifier(table ?? "", "Table"))}`;
}

function normalizePrivileges(values: readonly string[]): readonly string[] {
  if (values.length === 0) throw new Error("At least one privilege is required.");
  return [...new Set(values.map((value) => value.trim().toUpperCase()))].map((value) => {
    if (!/^[A-Z_ ]+$/u.test(value)) throw new Error(`Invalid privilege '${value}'.`);
    return value;
  });
}

function quoteAccount(value: string): string {
  const { name, host } = parseAccount(value);
  return `'${name.replaceAll("'", "''")}'@'${host.replaceAll("'", "''")}'`;
}

function parseAccount(value: string): { name: string; host: string } {
  const normalized = value.trim();
  const quoted = normalized.match(/^'((?:''|[^'])*)'@'((?:''|[^'])*)'$/u);
  if (quoted) return { name: quoted[1]!.replaceAll("''", "'"), host: quoted[2]!.replaceAll("''", "'") };
  const split = normalized.lastIndexOf("@");
  const name = (split >= 0 ? normalized.slice(0, split) : normalized).trim();
  const host = (split >= 0 ? normalized.slice(split + 1) : "%").trim() || "%";
  if (!name) throw new Error("Account or role name cannot be empty.");
  if (name.length > 128 || host.length > 255) throw new Error("Account or role identifier is too long.");
  return { name, host };
}

function formatAccount(name: string, host: string): string { return `'${name.replaceAll("'", "''")}'@'${host.replaceAll("'", "''")}'`; }
function securityScope(value: unknown): "global" | "schema" | "table" | "column" { const normalized = stringValue(value); return normalized === "schema" || normalized === "table" || normalized === "column" ? normalized : "global"; }
function yesNo(value: unknown): boolean { return ["Y", "YES", "1", "TRUE"].includes(stringValue(value).toUpperCase()); }
function boundedRows(value: number): number { if (!Number.isInteger(value) || value < 1 || value > 10_000) throw new Error("Row limit must be an integer between 1 and 10,000."); return value; }
function requireIdentifier(value: string, label: string): string { const normalized = value.trim(); if (!normalized) throw new Error(`${label} cannot be empty.`); if (normalized.length > 256) throw new Error(`${label} is too long.`); return normalized; }
function connectionArgs(connection: DatabaseExternalConnection, includeProtocol: boolean): string[] { return ["--host", requireIdentifier(connection.host, "Host"), "--port", String(connection.port ?? 3306), "--user", requireIdentifier(connection.user, "User"), ...(includeProtocol ? ["--protocol=TCP"] : [])]; }
function filterNamedValues<T extends { readonly name: string; readonly value: string }>(items: readonly T[], filter?: string): readonly T[] { const needle = filter?.trim().toLowerCase(); if (!needle) return items; return items.filter((item) => item.name.toLowerCase().includes(needle) || item.value.toLowerCase().includes(needle)); }
function optionalString(value: unknown): string | undefined { if (value === null || value === undefined) return undefined; const result = String(value).trim(); return result || undefined; }
function stringValue(value: unknown): string { return value === null || value === undefined ? "" : String(value); }
function finiteNumber(value: unknown): number { const result = typeof value === "number" ? value : Number(value); return Number.isFinite(result) ? result : 0; }
function optionalFiniteNumber(value: unknown): number | undefined { if (value === null || value === undefined || value === "") return undefined; const result = typeof value === "number" ? value : Number(value); return Number.isFinite(result) ? result : undefined; }

import type {
  DatabaseAccount,
  DatabaseAdministrationCapabilities,
  DatabaseAdministrationPreview,
  DatabaseAdministrationProvider,
  DatabaseBackupHook,
  DatabaseDataTransferRequest,
  DatabaseDataTransferResult,
  DatabaseLockWait,
  DatabasePrivilegeGrant,
  DatabaseRoleMembership,
  DatabaseSecurityChange,
  DatabaseServerSession,
  DatabaseServerStatus,
  DatabaseServerVariable,
  DatabaseSession,
  DatabaseStorageSummary,
  DatabaseTableCompareRequest,
  DatabaseTableCompareResult,
  DatabaseTableData,
  QueryExecution,
} from "@nublox/workbench-provider-api";

import type { MySqlDatabaseProvider } from "./index.js";

const PROCESSLIST_SQL = `SELECT ID AS sessionId, USER AS userName, HOST AS hostName, DB AS databaseName, COMMAND AS commandName, TIME AS timeSeconds, STATE AS stateName, INFO AS statementText FROM INFORMATION_SCHEMA.PROCESSLIST ORDER BY TIME DESC, ID ASC`;
const LOCK_WAITS_SQL = `SELECT waiting_thread.PROCESSLIST_ID AS waitingSessionId, blocking_thread.PROCESSLIST_ID AS blockingSessionId, CONCAT_WS('.', requested.OBJECT_SCHEMA, requested.OBJECT_NAME) AS objectName, requested.LOCK_TYPE AS lockType, requested.LOCK_MODE AS lockMode, TIMESTAMPDIFF(SECOND, waiting_trx.TRX_WAIT_STARTED, CURRENT_TIMESTAMP()) AS waitSeconds, COALESCE(waiting_statement.SQL_TEXT, waiting_trx.TRX_QUERY) AS statementText FROM performance_schema.data_lock_waits AS waits JOIN performance_schema.data_locks AS requested ON requested.ENGINE = waits.ENGINE AND requested.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads AS waiting_thread ON waiting_thread.THREAD_ID = waits.REQUESTING_THREAD_ID LEFT JOIN performance_schema.threads AS blocking_thread ON blocking_thread.THREAD_ID = waits.BLOCKING_THREAD_ID LEFT JOIN INFORMATION_SCHEMA.INNODB_TRX AS waiting_trx ON waiting_trx.TRX_MYSQL_THREAD_ID = waiting_thread.PROCESSLIST_ID LEFT JOIN performance_schema.events_statements_current AS waiting_statement ON waiting_statement.THREAD_ID = waits.REQUESTING_THREAD_ID WHERE waiting_thread.PROCESSLIST_ID IS NOT NULL ORDER BY waitSeconds DESC, waiting_thread.PROCESSLIST_ID, blocking_thread.PROCESSLIST_ID`;
const ACCOUNTS_SQL = `SELECT u.User AS userName, u.Host AS hostName, u.account_locked AS accountLocked, u.password_expired AS passwordExpired, CASE WHEN r.roleUser IS NULL THEN 'user' ELSE 'role' END AS accountKind FROM mysql.user AS u LEFT JOIN (SELECT DISTINCT FROM_USER AS roleUser, FROM_HOST AS roleHost FROM mysql.role_edges) AS r ON r.roleUser = u.User AND r.roleHost = u.Host ORDER BY accountKind, userName, hostName`;
const ROLES_SQL = `SELECT CONCAT(QUOTE(e.TO_USER), '@', QUOTE(e.TO_HOST)) AS grantee, CONCAT(QUOTE(e.FROM_USER), '@', QUOTE(e.FROM_HOST)) AS roleName, e.WITH_ADMIN_OPTION AS adminOption, CASE WHEN d.DEFAULT_ROLE_USER IS NULL THEN 'NO' ELSE 'YES' END AS defaultRole FROM mysql.role_edges AS e LEFT JOIN mysql.default_roles AS d ON d.USER=e.TO_USER AND d.HOST=e.TO_HOST AND d.DEFAULT_ROLE_USER=e.FROM_USER AND d.DEFAULT_ROLE_HOST=e.FROM_HOST ORDER BY grantee, roleName`;
const PRIVILEGES_SQL = `SELECT GRANTEE AS grantee, PRIVILEGE_TYPE AS privilegeType, IS_GRANTABLE AS isGrantable, 'global' AS scopeName, NULL AS schemaName, NULL AS tableName FROM INFORMATION_SCHEMA.USER_PRIVILEGES UNION ALL SELECT GRANTEE, PRIVILEGE_TYPE, IS_GRANTABLE, 'schema', TABLE_SCHEMA, NULL FROM INFORMATION_SCHEMA.SCHEMA_PRIVILEGES UNION ALL SELECT GRANTEE, PRIVILEGE_TYPE, IS_GRANTABLE, 'table', TABLE_SCHEMA, TABLE_NAME FROM INFORMATION_SCHEMA.TABLE_PRIVILEGES ORDER BY grantee, scopeName, schemaName, tableName, privilegeType`;
const STORAGE_SQL = `SELECT TABLE_SCHEMA AS catalogName, COUNT(*) AS tableCount, COALESCE(SUM(TABLE_ROWS),0) AS estimatedRows, COALESCE(SUM(DATA_LENGTH),0) AS dataBytes, COALESCE(SUM(INDEX_LENGTH),0) AS indexBytes, COALESCE(SUM(DATA_LENGTH + INDEX_LENGTH),0) AS totalBytes FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA NOT IN ('information_schema','mysql','performance_schema','sys') GROUP BY TABLE_SCHEMA ORDER BY totalBytes DESC, TABLE_SCHEMA`;

const ALLOWED_PRIVILEGES = new Set(["ALL PRIVILEGES","ALTER","ALTER ROUTINE","CREATE","CREATE ROLE","CREATE ROUTINE","CREATE TEMPORARY TABLES","CREATE USER","CREATE VIEW","DELETE","DROP","DROP ROLE","EVENT","EXECUTE","INDEX","INSERT","LOCK TABLES","PROCESS","REFERENCES","RELOAD","REPLICATION CLIENT","REPLICATION SLAVE","SELECT","SHOW DATABASES","SHOW VIEW","TRIGGER","UPDATE"]);

export const mysqlAdministrationCapabilities: DatabaseAdministrationCapabilities = Object.freeze({ sessions: true, locks: true, serverVariables: true, serverStatus: true, users: true, storage: true, importExport: true, backupRestore: true, dataTransfer: true });

export class MySqlAdministrationProvider implements DatabaseAdministrationProvider {
  readonly providerId = "mysql";
  readonly capabilities = mysqlAdministrationCapabilities;
  constructor(private readonly provider: Pick<MySqlDatabaseProvider, "execute">) {}

  async listSessions(session: DatabaseSession): Promise<readonly DatabaseServerSession[]> {
    const rows = await this.#rows(session, PROCESSLIST_SQL);
    return rows.map((row) => ({ id: stringValue(row.sessionId), user: stringValue(row.userName), ...(optionalString(row.hostName) ? { host: optionalString(row.hostName)! } : {}), ...(optionalString(row.databaseName) ? { database: optionalString(row.databaseName)! } : {}), command: stringValue(row.commandName), timeSeconds: finiteNumber(row.timeSeconds), ...(optionalString(row.stateName) ? { state: optionalString(row.stateName)! } : {}), ...(optionalString(row.statementText) ? { statement: optionalString(row.statementText)! } : {}) }));
  }

  async listLockWaits(session: DatabaseSession): Promise<readonly DatabaseLockWait[]> {
    const rows = await this.#rows(session, LOCK_WAITS_SQL);
    return rows.map((row) => ({ waitingSessionId: stringValue(row.waitingSessionId), ...(optionalString(row.blockingSessionId) ? { blockingSessionId: optionalString(row.blockingSessionId)! } : {}), ...(optionalString(row.objectName) ? { object: optionalString(row.objectName)! } : {}), ...(optionalString(row.lockType) ? { lockType: optionalString(row.lockType)! } : {}), ...(optionalString(row.lockMode) ? { lockMode: optionalString(row.lockMode)! } : {}), ...(optionalFiniteNumber(row.waitSeconds) !== undefined ? { waitSeconds: optionalFiniteNumber(row.waitSeconds)! } : {}), ...(optionalString(row.statementText) ? { statement: optionalString(row.statementText)! } : {}) }));
  }

  async listServerVariables(session: DatabaseSession, filter?: string): Promise<readonly DatabaseServerVariable[]> { return filterNamedValues((await this.#rows(session, "SHOW GLOBAL VARIABLES")).map((row) => ({ name: stringValue(row.Variable_name ?? row.variable_name ?? row.name), value: stringValue(row.Value ?? row.value) })), filter); }
  async listServerStatus(session: DatabaseSession, filter?: string): Promise<readonly DatabaseServerStatus[]> { return filterNamedValues((await this.#rows(session, "SHOW GLOBAL STATUS")).map((row) => ({ name: stringValue(row.Variable_name ?? row.variable_name ?? row.name), value: stringValue(row.Value ?? row.value) })), filter); }

  async listAccounts(session: DatabaseSession): Promise<readonly DatabaseAccount[]> {
    return (await this.#rows(session, ACCOUNTS_SQL)).map((row) => ({ grantee: account(stringValue(row.userName), stringValue(row.hostName)), user: stringValue(row.userName), host: stringValue(row.hostName), kind: stringValue(row.accountKind) === "role" ? "role" : "user", accountLocked: yes(row.accountLocked), passwordExpired: yes(row.passwordExpired) }));
  }

  async listRoleMemberships(session: DatabaseSession): Promise<readonly DatabaseRoleMembership[]> {
    return (await this.#rows(session, ROLES_SQL)).map((row) => ({ grantee: stringValue(row.grantee), role: stringValue(row.roleName), adminOption: yes(row.adminOption), defaultRole: yes(row.defaultRole) }));
  }

  async listPrivilegeGrants(session: DatabaseSession, grantee?: string): Promise<readonly DatabasePrivilegeGrant[]> {
    return (await this.#rows(session, PRIVILEGES_SQL)).filter((row) => !grantee || stringValue(row.grantee) === grantee).map((row) => ({ grantee: stringValue(row.grantee), privilege: stringValue(row.privilegeType), scope: scopeValue(row.scopeName), ...(optionalString(row.schemaName) ? { catalog: optionalString(row.schemaName)! } : {}), ...(optionalString(row.tableName) ? { table: optionalString(row.tableName)! } : {}), grantable: yes(row.isGrantable) }));
  }

  previewSecurityChange(change: DatabaseSecurityChange): DatabaseAdministrationPreview {
    const statement = securityStatement(change);
    const destructive = change.kind.startsWith("revoke");
    return { providerId: this.providerId, statements: [statement], destructive, confirmation: destructive ? "APPLY SECURITY REVOKE" : "APPLY SECURITY CHANGE", warnings: destructive ? ["Revoking access can interrupt applications or administrators that depend on the privilege or role."] : [] };
  }

  async executeSecurityChange(session: DatabaseSession, change: DatabaseSecurityChange): Promise<void> { await this.provider.execute(session, { sql: securityStatement(change), mode: "text" }); }

  async listStorage(session: DatabaseSession): Promise<readonly DatabaseStorageSummary[]> {
    return (await this.#rows(session, STORAGE_SQL)).map((row) => ({ catalog: stringValue(row.catalogName), tables: finiteNumber(row.tableCount), estimatedRows: finiteNumber(row.estimatedRows), dataBytes: finiteNumber(row.dataBytes), indexBytes: finiteNumber(row.indexBytes), totalBytes: finiteNumber(row.totalBytes) }));
  }

  async exportTable(session: DatabaseSession, catalog: string, table: string, limit = 10000): Promise<DatabaseTableData> {
    const bounded = Math.min(Math.max(Math.trunc(limit), 1), 100000);
    const execution = await this.provider.execute(session, { sql: `SELECT * FROM ${qualified(catalog, table)} LIMIT ${bounded}`, mode: "text" });
    const set = execution.resultSets[0];
    const rows = set?.rows ?? [];
    const columns = set?.columns.map((column) => column.name) ?? (rows[0] ? Object.keys(rows[0]) : []);
    return { catalog, table, columns, rows };
  }

  async importTable(session: DatabaseSession, data: DatabaseTableData, truncateTarget = false): Promise<DatabaseDataTransferResult> {
    const columns = data.columns.map(requireIdentifier);
    if (columns.length === 0) return { rowsRead: data.rows.length, rowsWritten: 0, target: `${data.catalog}.${data.table}` };
    if (truncateTarget) await this.provider.execute(session, { sql: `TRUNCATE TABLE ${qualified(data.catalog, data.table)}`, mode: "text" });
    const sql = `INSERT INTO ${qualified(data.catalog, data.table)} (${columns.map(quoteIdentifier).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
    let written = 0;
    for (const row of data.rows) { await this.provider.execute(session, { sql, values: columns.map((column) => row[column] ?? null), mode: "prepared" }); written += 1; }
    return { rowsRead: data.rows.length, rowsWritten: written, target: `${data.catalog}.${data.table}` };
  }

  async compareTables(session: DatabaseSession, request: DatabaseTableCompareRequest): Promise<DatabaseTableCompareResult> {
    const [left, right, leftColumns, rightColumns] = await Promise.all([
      this.#count(session, request.leftCatalog, request.leftTable), this.#count(session, request.rightCatalog, request.rightTable), this.#columns(session, request.leftCatalog, request.leftTable), this.#columns(session, request.rightCatalog, request.rightTable),
    ]);
    const leftSet = new Set(leftColumns); const rightSet = new Set(rightColumns);
    return { leftCount: left, rightCount: right, matchingColumns: leftColumns.filter((column) => rightSet.has(column)), leftOnlyColumns: leftColumns.filter((column) => !rightSet.has(column)), rightOnlyColumns: rightColumns.filter((column) => !leftSet.has(column)), rowCountDelta: right - left };
  }

  async transferTable(session: DatabaseSession, request: DatabaseDataTransferRequest): Promise<DatabaseDataTransferResult> {
    const data = await this.exportTable(session, request.sourceCatalog, request.sourceTable, request.limit ?? 10000);
    return this.importTable(session, { ...data, catalog: request.targetCatalog, table: request.targetTable }, request.truncateTarget ?? false);
  }

  listBackupHooks(): readonly DatabaseBackupHook[] {
    return [
      { id: "workbench-json", label: "Workbench logical JSON", available: true, description: "Portable table-level logical backup/restore through the guarded export/import pipeline." },
      { id: "mysqldump", label: "mysqldump", available: false, description: "External full-database backup hook reserved for a configured mysqldump executable; the RC does not invoke unconfigured system binaries." },
    ];
  }

  async #count(session: DatabaseSession, catalog: string, table: string): Promise<number> { const rows = await this.#rows(session, `SELECT COUNT(*) AS rowCount FROM ${qualified(catalog, table)}`); return finiteNumber(rows[0]?.rowCount); }
  async #columns(session: DatabaseSession, catalog: string, table: string): Promise<string[]> { const execution = await this.provider.execute(session, { sql: "SELECT COLUMN_NAME AS columnName FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION", values: [catalog, table], mode: "prepared" }); return (execution.resultSets[0]?.rows ?? []).map((row) => stringValue(row.columnName)); }
  async #rows(session: DatabaseSession, sql: string): Promise<readonly Readonly<Record<string, unknown>>[]> { const execution: QueryExecution = await this.provider.execute(session, { sql, mode: "text" }); return execution.resultSets[0]?.rows ?? []; }
}

function securityStatement(change: DatabaseSecurityChange): string {
  const grantee = normalizeAccount(change.grantee);
  if (change.kind === "grant-role" || change.kind === "revoke-role") { const role = normalizeAccount(change.role); return `${change.kind === "grant-role" ? "GRANT" : "REVOKE"} ${role} ${change.kind === "grant-role" ? "TO" : "FROM"} ${grantee}${change.kind === "grant-role" && change.adminOption ? " WITH ADMIN OPTION" : ""}`; }
  const privilege = normalizePrivilege(change.privilege);
  const target = change.scope === "global" ? "*.*" : change.scope === "schema" ? `${quoteIdentifier(requireIdentifier(change.catalog ?? ""))}.*` : `${quoteIdentifier(requireIdentifier(change.catalog ?? ""))}.${quoteIdentifier(requireIdentifier(change.table ?? ""))}`;
  return `${change.kind === "grant-privilege" ? "GRANT" : "REVOKE"} ${privilege} ON ${target} ${change.kind === "grant-privilege" ? "TO" : "FROM"} ${grantee}${change.kind === "grant-privilege" && change.withGrantOption ? " WITH GRANT OPTION" : ""}`;
}
function normalizePrivilege(value: string): string { const normalized = value.trim().replace(/\s+/gu, " ").toUpperCase(); if (!ALLOWED_PRIVILEGES.has(normalized)) throw new Error(`Unsupported or unsafe MySQL privilege '${value}'.`); return normalized; }
function normalizeAccount(value: string): string { const match = /^'((?:''|[^'])*)'@'((?:''|[^'])*)'$/.exec(value.trim()); if (!match) throw new Error("Account must use MySQL 'user'@'host' form."); return account(match[1]!.replaceAll("''", "'"), match[2]!.replaceAll("''", "'")); }
function account(user: string, host: string): string { return `'${user.replaceAll("'", "''")}'@'${host.replaceAll("'", "''")}'`; }
function quoteIdentifier(value: string): string { return `\`${value.replaceAll("`", "``")}\``; }
function qualified(catalog: string, table: string): string { return `${quoteIdentifier(requireIdentifier(catalog))}.${quoteIdentifier(requireIdentifier(table))}`; }
function requireIdentifier(value: string): string { const trimmed = value.trim(); if (!trimmed) throw new Error("Database identifier cannot be empty."); return trimmed; }
function scopeValue(value: unknown): DatabasePrivilegeGrant["scope"] { const text = stringValue(value); return text === "schema" || text === "table" ? text : "global"; }
function filterNamedValues<T extends { readonly name: string; readonly value: string }>(items: readonly T[], filter?: string): readonly T[] { const needle = filter?.trim().toLowerCase(); if (!needle) return items; return items.filter((item) => item.name.toLowerCase().includes(needle) || item.value.toLowerCase().includes(needle)); }
function optionalString(value: unknown): string | undefined { if (value === null || value === undefined) return undefined; const result = String(value).trim(); return result || undefined; }
function stringValue(value: unknown): string { return value === null || value === undefined ? "" : String(value); }
function finiteNumber(value: unknown): number { const result = typeof value === "number" ? value : Number(value); return Number.isFinite(result) ? result : 0; }
function optionalFiniteNumber(value: unknown): number | undefined { if (value === null || value === undefined || value === "") return undefined; const result = typeof value === "number" ? value : Number(value); return Number.isFinite(result) ? result : undefined; }
function yes(value: unknown): boolean { return String(value ?? "").toUpperCase() === "Y" || String(value ?? "").toUpperCase() === "YES" || value === 1 || value === true; }

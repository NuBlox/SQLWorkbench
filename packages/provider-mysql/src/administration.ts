import type {
  DatabaseAdministrationCapabilities,
  DatabaseAdministrationProvider,
  DatabaseLockWait,
  DatabaseServerSession,
  DatabaseServerStatus,
  DatabaseServerVariable,
  DatabaseSession,
  QueryExecution,
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
  waiting_statement.SQL_TEXT AS statementText
FROM performance_schema.data_lock_waits AS waits
JOIN performance_schema.data_locks AS requested
  ON requested.ENGINE = waits.ENGINE
 AND requested.ENGINE_LOCK_ID = waits.REQUESTING_ENGINE_LOCK_ID
JOIN performance_schema.threads AS waiting_thread
  ON waiting_thread.THREAD_ID = waits.REQUESTING_THREAD_ID
LEFT JOIN performance_schema.threads AS blocking_thread
  ON blocking_thread.THREAD_ID = waits.BLOCKING_THREAD_ID
LEFT JOIN performance_schema.events_statements_current AS waiting_statement
  ON waiting_statement.THREAD_ID = waits.REQUESTING_THREAD_ID
WHERE waiting_thread.PROCESSLIST_ID IS NOT NULL
ORDER BY waiting_thread.PROCESSLIST_ID, blocking_thread.PROCESSLIST_ID`;

export const mysqlAdministrationCapabilities: DatabaseAdministrationCapabilities = Object.freeze({
  sessions: true,
  locks: true,
  serverVariables: true,
  serverStatus: true,
  users: false,
  storage: false,
  importExport: false,
  backupRestore: false,
  dataTransfer: false,
});

export class MySqlAdministrationProvider implements DatabaseAdministrationProvider {
  readonly providerId = "mysql";
  readonly capabilities = mysqlAdministrationCapabilities;

  constructor(private readonly provider: Pick<MySqlDatabaseProvider, "execute">) {}

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

  async #rows(session: DatabaseSession, sql: string): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const execution: QueryExecution = await this.provider.execute(session, { sql, mode: "text" });
    return execution.resultSets[0]?.rows ?? [];
  }
}

function filterNamedValues<T extends { readonly name: string; readonly value: string }>(items: readonly T[], filter?: string): readonly T[] {
  const needle = filter?.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => item.name.toLowerCase().includes(needle) || item.value.toLowerCase().includes(needle));
}

function optionalString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const result = String(value).trim();
  return result || undefined;
}

function stringValue(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function finiteNumber(value: unknown): number {
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : 0;
}

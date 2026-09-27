import type {
  ConnectionCredential,
  ConnectionProfile,
  ConnectionProfileDraft,
  ConnectionProfileRepository,
  CredentialStore,
} from "@nublox/workbench-connection-profiles";
import { ConnectionProfileResolver } from "@nublox/workbench-connection-profiles";
import type { WorkbenchConnection } from "@nublox/workbench-core";
import {
  ConnectionManager,
  DatabaseExplorerService,
  QueryService,
} from "@nublox/workbench-core";

import type {
  DeleteProfileRequest,
  ExecuteQueryRequest,
  ExplorerNamespaceRequest,
  ExplorerRelationDetailsRequest,
  ExplorerRelationRequest,
  OpenConnectionInfo,
  QueryCellValue,
  QueryExecutionView,
  QueryHistoryEntry,
  QueryResultSetView,
  SaveProfileRequest,
} from "../lib/desktop-api.js";
import { splitSqlScript } from "../lib/sql-text.js";
import { QueryHistoryStore } from "./query-history-store.js";

type ProviderExecution = Awaited<ReturnType<QueryService["execute"]>>;
type ProviderResultSet = ProviderExecution["resultSets"][number];

interface ActiveExecution {
  readonly connectionId: string;
  readonly controller: AbortController;
}

export class DesktopServices {
  readonly #resolver: ConnectionProfileResolver;
  readonly #queries: QueryService;
  readonly #explorer: DatabaseExplorerService;
  readonly #activeExecutions = new Map<string, ActiveExecution>();

  constructor(
    readonly profiles: ConnectionProfileRepository,
    readonly credentials: CredentialStore,
    readonly connections: ConnectionManager,
    readonly history: QueryHistoryStore,
  ) {
    this.#resolver = new ConnectionProfileResolver(profiles, credentials);
    this.#queries = new QueryService(connections);
    this.#explorer = new DatabaseExplorerService(connections);
  }

  listProfiles(): Promise<readonly ConnectionProfile[]> {
    return this.profiles.list();
  }

  async saveProfile(request: SaveProfileRequest): Promise<ConnectionProfile> {
    const existing = await this.profiles.get(request.draft.id);
    const credentialProvided = request.credential !== undefined;
    const credentialId = credentialProvided
      ? credentialIdForProfile(request.draft.id)
      : existing?.credentialId;
    const nextDraft = withCredentialId(request.draft, credentialId);

    if (!credentialProvided) {
      return request.expectedRevision === undefined
        ? this.profiles.create(nextDraft)
        : this.profiles.update(nextDraft, request.expectedRevision);
    }

    const previousCredentialId = existing?.credentialId;
    const previousCredential = previousCredentialId
      ? await this.credentials.get(previousCredentialId)
      : undefined;

    await this.credentials.set(credentialId!, request.credential!);
    try {
      const profile = request.expectedRevision === undefined
        ? await this.profiles.create(nextDraft)
        : await this.profiles.update(nextDraft, request.expectedRevision);

      if (previousCredentialId && previousCredentialId !== credentialId) {
        await this.credentials.delete(previousCredentialId);
      }
      return profile;
    } catch (error) {
      await this.#restoreCredential(credentialId!, previousCredentialId, previousCredential);
      throw error;
    }
  }

  async removeProfile(request: DeleteProfileRequest): Promise<void> {
    const profile = await this.profiles.get(request.id);
    const credentialId = profile?.credentialId;
    const previousCredential = credentialId
      ? await this.credentials.get(credentialId)
      : undefined;

    if (credentialId) await this.credentials.delete(credentialId);
    try {
      await this.profiles.delete(request.id, request.expectedRevision);
    } catch (error) {
      if (credentialId && previousCredential) {
        await this.credentials.set(credentialId, previousCredential);
      }
      throw error;
    }

    await this.disconnectProfile(request.id);
  }

  async clearCredential(profileId: string): Promise<ConnectionProfile> {
    const profile = await this.profiles.get(profileId);
    if (!profile) throw new Error(`Connection profile '${profileId}' does not exist.`);
    if (!profile.credentialId) return profile;

    const previousCredential = await this.credentials.get(profile.credentialId);
    await this.credentials.delete(profile.credentialId);
    try {
      return await this.profiles.update(withCredentialId(profile, undefined), profile.revision);
    } catch (error) {
      if (previousCredential) {
        await this.credentials.set(profile.credentialId, previousCredential);
      }
      throw error;
    }
  }

  async listConnections(): Promise<readonly OpenConnectionInfo[]> {
    return Promise.all(this.connections.list().map((connection) => toConnectionInfo(connection)));
  }

  async connectProfile(profileId: string): Promise<OpenConnectionInfo> {
    const current = this.connections.list().find((connection) => connection.id === profileId);
    if (current) return toConnectionInfo(current);

    const config = await this.#resolver.resolve(profileId);
    const connection = await this.connections.connect(profileId, config);
    return toConnectionInfo(connection);
  }

  async disconnectProfile(profileId: string): Promise<void> {
    this.#cancelConnectionQueries(profileId);
    if (!this.connections.list().some((connection) => connection.id === profileId)) return;
    await this.connections.disconnect(profileId);
  }

  listExplorerNamespaces(request: ExplorerNamespaceRequest) {
    return this.#explorer.listNamespaces(request);
  }

  listExplorerRelations(request: ExplorerRelationRequest) {
    return this.#explorer.listRelations(request);
  }

  describeExplorerRelation(request: ExplorerRelationDetailsRequest) {
    return this.#explorer.describeRelation(request);
  }

  async executeQuery(request: ExecuteQueryRequest): Promise<QueryExecutionView> {
    const executionId = requireNonEmpty(request.executionId, "Execution id");
    const connectionId = requireNonEmpty(request.connectionId, "Connection id");
    const sql = requireNonEmpty(request.sql, "SQL");
    if (this.#activeExecutions.has(executionId)) {
      throw new Error(`Query execution '${executionId}' is already active.`);
    }
    this.connections.get(connectionId);

    const statements = request.mode === "script"
      ? splitSqlScript(sql).map((segment) => segment.text)
      : [sql];
    if (statements.length === 0) throw new Error("SQL script does not contain an executable statement.");

    const controller = new AbortController();
    this.#activeExecutions.set(executionId, { connectionId, controller });
    const startedAt = new Date();
    const startedMs = Date.now();
    let resultSetCount = 0;

    try {
      const resultSets: QueryResultSetView[] = [];
      for (const statement of statements) {
        if (controller.signal.aborted) throw cancellationError();
        const execution = await this.#queries.execute(connectionId, {
          sql: statement,
          mode: "text",
          ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
          signal: controller.signal,
        });
        const normalized = execution.resultSets.map(normalizeResultSet);
        resultSets.push(...normalized);
        resultSetCount += normalized.length;
      }

      const finishedAt = new Date();
      const view: QueryExecutionView = {
        executionId,
        connectionId,
        mode: request.mode,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        elapsedMs: Date.now() - startedMs,
        statementCount: statements.length,
        resultSets,
      };
      await this.#recordHistory({
        id: executionId,
        connectionId,
        mode: request.mode,
        sql,
        startedAt: view.startedAt,
        elapsedMs: view.elapsedMs,
        status: "success",
        statementCount: statements.length,
        resultSetCount,
      });
      return view;
    } catch (error) {
      const cancelled = controller.signal.aborted;
      const message = errorMessage(error);
      await this.#recordHistory({
        id: executionId,
        connectionId,
        mode: request.mode,
        sql,
        startedAt: startedAt.toISOString(),
        elapsedMs: Date.now() - startedMs,
        status: cancelled ? "cancelled" : "error",
        statementCount: statements.length,
        resultSetCount,
        message,
      });
      if (cancelled) throw cancellationError();
      throw error;
    } finally {
      this.#activeExecutions.delete(executionId);
    }
  }

  cancelQuery(executionId: string): boolean {
    const active = this.#activeExecutions.get(executionId.trim());
    if (!active) return false;
    active.controller.abort(cancellationError());
    return true;
  }

  cancelAllQueries(): void {
    for (const active of this.#activeExecutions.values()) {
      active.controller.abort(cancellationError());
    }
  }

  listHistory(limit?: number): Promise<readonly QueryHistoryEntry[]> {
    return this.history.list(limit);
  }

  clearHistory(): Promise<void> {
    return this.history.clear();
  }

  #cancelConnectionQueries(connectionId: string): void {
    for (const active of this.#activeExecutions.values()) {
      if (active.connectionId === connectionId) active.controller.abort(cancellationError());
    }
  }

  async #recordHistory(entry: QueryHistoryEntry): Promise<void> {
    try {
      await this.history.add(entry);
    } catch (error) {
      console.error("Failed to persist query history.", error);
    }
  }

  async #restoreCredential(
    newCredentialId: string,
    previousCredentialId: string | undefined,
    previousCredential: ConnectionCredential | undefined,
  ): Promise<void> {
    if (previousCredentialId === newCredentialId && previousCredential) {
      await this.credentials.set(previousCredentialId, previousCredential);
      return;
    }

    await this.credentials.delete(newCredentialId);
    if (previousCredentialId && previousCredential) {
      await this.credentials.set(previousCredentialId, previousCredential);
    }
  }
}

function credentialIdForProfile(profileId: string): string {
  const id = profileId.trim();
  if (!id) throw new Error("Connection profile id cannot be empty.");
  return `connection:${id}`;
}

function withCredentialId(
  source: ConnectionProfileDraft | ConnectionProfile,
  credentialId: string | undefined,
): ConnectionProfileDraft {
  return {
    id: source.id,
    name: source.name,
    providerId: source.providerId,
    host: source.host,
    user: source.user,
    ...(source.port !== undefined ? { port: source.port } : {}),
    ...(source.database !== undefined ? { database: source.database } : {}),
    ...(source.connectTimeoutMs !== undefined
      ? { connectTimeoutMs: source.connectTimeoutMs }
      : {}),
    ...(source.tls !== undefined ? { tls: source.tls } : {}),
    ...(source.options !== undefined ? { options: source.options } : {}),
    ...(credentialId !== undefined ? { credentialId } : {}),
  };
}

async function toConnectionInfo(connection: WorkbenchConnection): Promise<OpenConnectionInfo> {
  const health = await connection.session.health();
  return {
    id: connection.id,
    profileId: connection.id,
    providerId: connection.provider.id,
    connectedAt: connection.session.connectedAt,
    healthy: health.ok,
    ...(health.latencyMs !== undefined ? { latencyMs: health.latencyMs } : {}),
    ...(health.message !== undefined ? { message: health.message } : {}),
  };
}

function normalizeResultSet(resultSet: ProviderResultSet): QueryResultSetView {
  return {
    columns: resultSet.columns.map((column) => ({
      name: column.name,
      ...(column.table !== undefined ? { table: column.table } : {}),
      ...(column.catalog !== undefined ? { catalog: column.catalog } : {}),
      ...(column.databaseType !== undefined ? { databaseType: column.databaseType } : {}),
    })),
    rows: resultSet.rows.map((row) => {
      const normalized: Record<string, QueryCellValue> = {};
      for (const [key, value] of Object.entries(row)) normalized[key] = normalizeCell(value);
      return normalized;
    }),
    ...(resultSet.affectedRows !== undefined ? { affectedRows: resultSet.affectedRows } : {}),
    ...(resultSet.changedRows !== undefined ? { changedRows: resultSet.changedRows } : {}),
    ...(resultSet.insertId !== undefined ? { insertId: resultSet.insertId } : {}),
    ...(resultSet.warningCount !== undefined ? { warningCount: resultSet.warningCount } : {}),
    ...(resultSet.message !== undefined ? { message: resultSet.message } : {}),
  };
}

function normalizeCell(value: unknown): QueryCellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `0x${value.toString("hex")}`;
  if (value instanceof Uint8Array) return `0x${Buffer.from(value).toString("hex")}`;
  try {
    const serialized = JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    );
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

function requireNonEmpty(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} cannot be empty.`);
  return normalized;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function cancellationError(): Error {
  const error = new Error("Query execution cancelled.");
  error.name = "AbortError";
  return error;
}

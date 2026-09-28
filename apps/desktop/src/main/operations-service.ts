import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import {
  ConnectionProfileResolver,
  type ConnectionProfileRepository,
  type CredentialStore,
} from "@nublox/workbench-connection-profiles";
import type { ConnectionManager } from "@nublox/workbench-core";
import type {
  DatabaseAdministrationProvider,
  DatabaseSecurityChange,
  DatabaseStorageEntry,
  QueryResultSet,
} from "@nublox/workbench-provider-api";

import type {
  AdministrationBackupRequest,
  AdministrationCompareRequest,
  AdministrationCompareResult,
  AdministrationDataFileResult,
  AdministrationExternalToolResult,
  AdministrationSecurityChangeRequest,
  AdministrationSecurityExecuteRequest,
  AdministrationSecurityExecutionResult,
  AdministrationSecurityPreparedPreview,
  AdministrationTableRequest,
  AdministrationTransferExecuteRequest,
  AdministrationTransferPreparedPreview,
  AdministrationTransferPreviewRequest,
  AdministrationTransferResult,
} from "../lib/desktop-api.js";

const MAX_DATA_ROWS = 10_000;

export class DesktopOperationsService {
  readonly #resolver: ConnectionProfileResolver;

  constructor(
    private readonly connections: ConnectionManager,
    profiles: ConnectionProfileRepository,
    credentials: CredentialStore,
  ) {
    this.#resolver = new ConnectionProfileResolver(profiles, credentials);
  }

  async principals(connectionId: string) {
    const { administration, session } = this.#require(connectionId, "users", "security principal inspection");
    if (!administration.listSecurityPrincipals) throw missing(administration, "security principal inspection");
    return administration.listSecurityPrincipals(session);
  }

  async privileges(connectionId: string, grantee?: string) {
    const { administration, session } = this.#require(connectionId, "users", "security privilege inspection");
    if (!administration.listSecurityPrivileges) throw missing(administration, "security privilege inspection");
    return administration.listSecurityPrivileges(session, grantee?.trim() || undefined);
  }

  async roles(connectionId: string) {
    const { administration, session } = this.#require(connectionId, "users", "role membership inspection");
    if (!administration.listRoleMemberships) throw missing(administration, "role membership inspection");
    return administration.listRoleMemberships(session);
  }

  async previewSecurity(request: AdministrationSecurityChangeRequest): Promise<AdministrationSecurityPreparedPreview> {
    const { administration } = this.#require(request.connectionId, "users", "security administration");
    if (!administration.previewSecurityChange) throw missing(administration, "security change preview");
    const preview = administration.previewSecurityChange(request.change);
    const fingerprint = securityFingerprint(request.connectionId, request.change, preview.statements);
    return {
      preview,
      guard: {
        fingerprint,
        destructive: preview.destructive,
        confirmationPhrase: preview.destructive ? "APPLY DESTRUCTIVE SECURITY CHANGE" : "APPLY SECURITY CHANGE",
      },
    };
  }

  async executeSecurity(request: AdministrationSecurityExecuteRequest): Promise<AdministrationSecurityExecutionResult> {
    const prepared = await this.previewSecurity(request);
    if (request.fingerprint !== prepared.guard.fingerprint) throw new Error("Security preview is stale. Generate a fresh preview before applying changes.");
    if (request.confirmation !== prepared.guard.confirmationPhrase) throw new Error(`Confirmation must exactly match '${prepared.guard.confirmationPhrase}'.`);
    const { administration, session } = this.#require(request.connectionId, "users", "security administration");
    if (!administration.applySecurityChange) throw missing(administration, "security change execution");
    await administration.applySecurityChange(session, request.change);
    return { completed: true, statementsExecuted: prepared.preview.statements.length };
  }

  async storage(connectionId: string): Promise<readonly DatabaseStorageEntry[]> {
    const { administration, session } = this.#require(connectionId, "storage", "storage inspection");
    if (!administration.listStorage) throw missing(administration, "storage inspection");
    return administration.listStorage(session);
  }

  async exportData(request: AdministrationTableRequest, path: string, format: "json" | "csv"): Promise<AdministrationDataFileResult> {
    const result = await this.#read(request);
    const body = format === "csv" ? serializeCsv(result) : `${JSON.stringify(result.rows, null, 2)}\n`;
    await writeFile(path, body, { encoding: "utf8", mode: 0o600 });
    return { canceled: false, path, rowsRead: result.rows.length };
  }

  async importData(request: AdministrationTableRequest, path: string): Promise<AdministrationDataFileResult> {
    const { administration, session } = this.#require(request.connectionId, "importExport", "data import");
    if (!administration.writeTableRows) throw missing(administration, "data import");
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!Array.isArray(parsed) || !parsed.every(isRecord)) throw new Error("Import file must contain a JSON array of objects.");
    if (parsed.length > MAX_DATA_ROWS) throw new Error(`Import cannot exceed ${MAX_DATA_ROWS.toLocaleString()} rows per operation.`);
    const written = await administration.writeTableRows(session, { catalog: request.catalog, table: request.table, rows: parsed });
    return { canceled: false, path, rowsRead: parsed.length, rowsWritten: written.rowsWritten };
  }

  async compareData(request: AdministrationCompareRequest): Promise<AdministrationCompareResult> {
    const limit = boundedLimit(request.limit);
    const [left, right] = await Promise.all([
      this.#read({ connectionId: request.leftConnectionId, catalog: request.leftCatalog, table: request.leftTable, limit }),
      this.#read({ connectionId: request.rightConnectionId, catalog: request.rightCatalog, table: request.rightTable, limit }),
    ]);
    const leftColumns = left.columns.map((column) => column.name);
    const rightColumns = right.columns.map((column) => column.name);
    const leftCounts = multiset(left.rows);
    const rightCounts = multiset(right.rows);
    let matchingRows = 0;
    let onlyLeft = 0;
    let onlyRight = 0;
    for (const [key, count] of leftCounts) {
      const other = rightCounts.get(key) ?? 0;
      matchingRows += Math.min(count, other);
      onlyLeft += Math.max(0, count - other);
    }
    for (const [key, count] of rightCounts) onlyRight += Math.max(0, count - (leftCounts.get(key) ?? 0));
    return {
      leftRows: left.rows.length,
      rightRows: right.rows.length,
      matchingRows,
      differentRows: onlyLeft + onlyRight,
      onlyLeft,
      onlyRight,
      leftColumns,
      rightColumns,
      columnsMatch: JSON.stringify(leftColumns) === JSON.stringify(rightColumns),
    };
  }

  async previewTransfer(request: AdministrationTransferPreviewRequest): Promise<AdministrationTransferPreparedPreview> {
    const limit = boundedLimit(request.limit);
    const source = await this.#read({ connectionId: request.leftConnectionId, catalog: request.leftCatalog, table: request.leftTable, limit });
    const target = await this.#read({ connectionId: request.rightConnectionId, catalog: request.rightCatalog, table: request.rightTable, limit });
    return {
      sourceRows: source.rows.length,
      targetRows: target.rows.length,
      guard: {
        fingerprint: transferFingerprint(request, source.rows),
        destructive: false,
        confirmationPhrase: "TRANSFER DATA",
      },
    };
  }

  async executeTransfer(request: AdministrationTransferExecuteRequest): Promise<AdministrationTransferResult> {
    const limit = boundedLimit(request.limit);
    const source = await this.#read({ connectionId: request.leftConnectionId, catalog: request.leftCatalog, table: request.leftTable, limit });
    const fingerprint = transferFingerprint(request, source.rows);
    if (request.fingerprint !== fingerprint) throw new Error("Transfer preview is stale. Generate a fresh preview before transferring data.");
    if (request.confirmation !== "TRANSFER DATA") throw new Error("Confirmation must exactly match 'TRANSFER DATA'.");
    const { administration, session } = this.#require(request.rightConnectionId, "dataTransfer", "data transfer");
    if (!administration.writeTableRows) throw missing(administration, "data transfer");
    const written = await administration.writeTableRows(session, { catalog: request.rightCatalog, table: request.rightTable, rows: source.rows });
    return { ...written, sourceRows: source.rows.length };
  }

  async backup(request: AdministrationBackupRequest, path: string): Promise<AdministrationExternalToolResult> {
    const { administration } = this.#require(request.connectionId, "backupRestore", "backup");
    if (!administration.createBackupPlan) throw missing(administration, "backup hook");
    const config = await this.#resolver.resolve(request.connectionId);
    const plan = administration.createBackupPlan(config, request.catalog);
    return runExternal(plan, path, config.password);
  }

  async restore(request: AdministrationBackupRequest, path: string, confirmation: string): Promise<AdministrationExternalToolResult> {
    if (confirmation !== "RESTORE DATABASE") throw new Error("Confirmation must exactly match 'RESTORE DATABASE'.");
    const { administration } = this.#require(request.connectionId, "backupRestore", "restore");
    if (!administration.createRestorePlan) throw missing(administration, "restore hook");
    const config = await this.#resolver.resolve(request.connectionId);
    const plan = administration.createRestorePlan(config, request.catalog);
    return runExternal(plan, path, config.password);
  }

  async #read(request: AdministrationTableRequest): Promise<QueryResultSet> {
    const { administration, session } = this.#require(request.connectionId, "importExport", "table data read");
    if (!administration.readTableRows) throw missing(administration, "table data read");
    return administration.readTableRows(session, { catalog: request.catalog, table: request.table, limit: boundedLimit(request.limit) });
  }

  #require(connectionId: string, capability: keyof DatabaseAdministrationProvider["capabilities"], action: string) {
    const normalized = connectionId.trim();
    if (!normalized) throw new Error("Connection id cannot be empty.");
    const { provider, session } = this.connections.get(normalized);
    const administration = provider.administration;
    if (!administration || !administration.capabilities[capability]) throw new Error(`Database provider '${provider.id}' does not support ${action}.`);
    return { administration, session };
  }
}

function boundedLimit(value?: number): number {
  const limit = value ?? 1_000;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DATA_ROWS) throw new Error(`Row limit must be an integer between 1 and ${MAX_DATA_ROWS.toLocaleString()}.`);
  return limit;
}

function securityFingerprint(connectionId: string, change: DatabaseSecurityChange, statements: readonly string[]): string {
  return digest(JSON.stringify({ connectionId, change, statements }));
}
function transferFingerprint(request: AdministrationTransferPreviewRequest, rows: readonly Readonly<Record<string, unknown>>[]): string {
  return digest(JSON.stringify({ request, rows: rows.map(canonicalRow) }));
}
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function canonicalRow(row: Readonly<Record<string, unknown>>): Record<string, unknown> { return Object.fromEntries(Object.keys(row).sort().map((key) => [key, row[key]])); }
function multiset(rows: readonly Readonly<Record<string, unknown>>[]): Map<string, number> { const result = new Map<string, number>(); for (const row of rows) { const key = JSON.stringify(canonicalRow(row)); result.set(key, (result.get(key) ?? 0) + 1); } return result; }
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function missing(provider: DatabaseAdministrationProvider, feature: string): Error { return new Error(`Database provider '${provider.providerId}' advertises ${feature} but does not implement it.`); }

function serializeCsv(result: QueryResultSet): string {
  const columns = result.columns.map((column) => column.name);
  const header = columns.map(csvCell).join(",");
  const rows = result.rows.map((row) => columns.map((column) => csvCell(row[column])).join(","));
  return [header, ...rows].join("\n") + "\n";
}
function csvCell(value: unknown): string { const text = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value); const safe = /^[=+\-@]/u.test(text) ? `'${text}` : text; return /[",\n\r]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe; }

async function runExternal(plan: { readonly executable: string; readonly args: readonly string[]; readonly direction: "stdout-to-file" | "file-to-stdin"; readonly passwordEnvironmentVariable?: string }, path: string, password?: string): Promise<AdministrationExternalToolResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...(plan.passwordEnvironmentVariable && password !== undefined ? { [plan.passwordEnvironmentVariable]: password } : {}) };
    const child = spawn(plan.executable, [...plan.args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { stderr += chunk; if (stderr.length > 64_000) stderr = stderr.slice(-64_000); });
    child.on("error", (error) => reject(new Error(`Unable to start '${plan.executable}': ${error.message}`)));
    if (plan.direction === "stdout-to-file") {
      child.stdout.pipe(createWriteStream(path, { mode: 0o600 }));
      child.stdin.end();
    } else {
      child.stdout.resume();
      createReadStream(path).pipe(child.stdin);
    }
    child.on("close", (exitCode) => resolve({ canceled: false, path, executable: plan.executable, exitCode: exitCode ?? -1, ...(stderr.trim() ? { stderr: stderr.trim() } : {}) }));
  });
}

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage } from "electron";
import { JsonConnectionProfileRepository } from "@nublox/workbench-connection-profiles";
import { ConnectionManager, ProviderRegistry } from "@nublox/workbench-core";
import { MySqlWorkbenchProvider } from "@nublox/workbench-provider-mysql/workbench";
import type { DatabaseTableData } from "@nublox/workbench-provider-api";

import type {
  CompareRequest, SecurityExecuteRequest, SecurityPreviewRequest, TableExportRequest, TableExportResponse,
  TableImportRequest, TableImportResponse, TransferRequest,
} from "../lib/administration-operations.js";
import type {
  AdministrationValueRequest, DeleteProfileRequest, ErExecuteRequest, ErRelationshipRequest, ExecuteQueryRequest, ExplainQueryRequest,
  ExplorerNamespaceRequest, ExplorerPrivilegeRequest, ExplorerRelationDetailsRequest, ExplorerRelationRequest,
  ExplorerSearchRequest, ExportResultRequest, ExportResultResponse, QueryPlanHistoryListRequest, QueryStatisticsRequest,
  SaveProfileRequest, SchemaExecuteRequest, SchemaGraphRequest, SchemaLoadRequest, SchemaPreviewRequest,
  ViewExecuteRequest, ViewLoadRequest, ViewPreviewRequest,
} from "../lib/desktop-api.js";
import { DesktopAdministrationService } from "./administration-service.js";
import { EncryptedFileCredentialStore, type SecretCipher } from "./encrypted-credential-store.js";
import { DesktopErService } from "./er-service.js";
import { DesktopExplainService } from "./explain-service.js";
import { QueryPlanHistoryStore } from "./plan-history-store.js";
import { QueryHistoryStore } from "./query-history-store.js";
import { DesktopQueryLanguageService } from "./query-language-service.js";
import { QueryStatisticsService } from "./query-statistics-service.js";
import { rendererFailureHtml, resolveRendererAssetPath, verifyRendererBootstrap } from "./renderer-bootstrap.js";
import { serializeResultSetCsv, serializeResultSetJson } from "./result-export.js";
import { DesktopSchemaService } from "./schema-service.js";
import { DesktopServices } from "./services.js";
import { DesktopViewService } from "./view-service.js";

const IPC = Object.freeze({
  profilesList: "nublox:profiles:list", profilesSave: "nublox:profiles:save", profilesRemove: "nublox:profiles:remove", profilesClearCredential: "nublox:profiles:clear-credential",
  connectionsList: "nublox:connections:list", connectionsConnect: "nublox:connections:connect", connectionsDisconnect: "nublox:connections:disconnect",
  administrationSessions: "nublox:administration:sessions", administrationLocks: "nublox:administration:locks", administrationVariables: "nublox:administration:variables", administrationStatus: "nublox:administration:status",
  operationsAccounts: "nublox:operations:accounts", operationsRoles: "nublox:operations:roles", operationsPrivileges: "nublox:operations:privileges", operationsSecurityPreview: "nublox:operations:security-preview", operationsSecurityExecute: "nublox:operations:security-execute", operationsStorage: "nublox:operations:storage", operationsExport: "nublox:operations:export", operationsImport: "nublox:operations:import", operationsCompare: "nublox:operations:compare", operationsTransfer: "nublox:operations:transfer", operationsBackupHooks: "nublox:operations:backup-hooks",
  explorerNamespaces: "nublox:explorer:namespaces", explorerRelations: "nublox:explorer:relations", explorerDescribe: "nublox:explorer:describe", explorerRoutines: "nublox:explorer:routines", explorerTriggers: "nublox:explorer:triggers", explorerEvents: "nublox:explorer:events", explorerPrincipals: "nublox:explorer:principals", explorerRoles: "nublox:explorer:roles", explorerPrivileges: "nublox:explorer:privileges", explorerSearch: "nublox:explorer:search",
  queryLanguageCatalog: "nublox:query-language:catalog", schemaLoad: "nublox:schema:load", schemaPreview: "nublox:schema:preview", schemaGraph: "nublox:schema:graph", schemaExecute: "nublox:schema:execute",
  viewLoad: "nublox:views:load", viewPreview: "nublox:views:preview", viewExecute: "nublox:views:execute", erPreview: "nublox:er:preview", erExecute: "nublox:er:execute",
  queriesExecute: "nublox:queries:execute", queriesExplain: "nublox:queries:explain", queriesCancel: "nublox:queries:cancel",
  historyList: "nublox:history:list", historyClear: "nublox:history:clear", planHistoryList: "nublox:plan-history:list", planHistoryClear: "nublox:plan-history:clear", queryStatistics: "nublox:statistics:query",
  resultsExport: "nublox:results:export", appVersion: "nublox:app:version", rendererReady: "nublox:renderer:ready",
});

const RENDERER_SCHEME = "nublox";
const RENDERER_URL = `${RENDERER_SCHEME}://app/`;
const RENDERER_READY_TIMEOUT_MS = 5_000;
const currentDirectory = dirname(fileURLToPath(import.meta.url));
const rendererRoot = resolve(currentDirectory, "../../../build/renderer");
let services: DesktopServices | undefined;
let allowQuit = false;

protocol.registerSchemesAsPrivileged([{
  scheme: RENDERER_SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, codeCache: true },
}]);

app.setName("NuBlox SQL Workbench");

app.whenReady().then(async () => {
  await logStartup("Electron ready.");
  await registerRendererProtocol();
  services = createServices();
  registerIpc(services);
  await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}).catch((error: unknown) => {
  const detail = errorMessage(error);
  console.error("Failed to start NuBlox SQL Workbench.", error);
  void logStartup(`Fatal application startup failure: ${detail}`);
  dialog.showErrorBox("NuBlox SQL Workbench failed to start", detail);
  app.quit();
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", (event) => {
  if (allowQuit || !services) return;
  event.preventDefault();
  allowQuit = true;
  services.cancelAllQueries();
  void services.connections.disconnectAll()
    .catch((error: unknown) => console.error("Failed to close one or more database sessions.", error))
    .finally(() => app.quit());
});

async function registerRendererProtocol(): Promise<void> {
  protocol.handle(RENDERER_SCHEME, async (request) => {
    const assetPath = resolveRendererAssetPath(rendererRoot, request.url);
    if (!assetPath) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    try { return await net.fetch(pathToFileURL(assetPath).toString()); }
    catch (error) {
      const detail = `Renderer asset request failed for '${request.url}': ${errorMessage(error)}`;
      console.error(detail); void logStartup(detail);
      return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
  });
  await logStartup(`Renderer protocol registered at ${RENDERER_URL}.`);
}

function createServices(): DesktopServices {
  const userData = app.getPath("userData");
  const profiles = new JsonConnectionProfileRepository(join(userData, "connection-profiles.json"));
  const credentials = new EncryptedFileCredentialStore(join(userData, "connection-credentials.json"), createSafeStorageCipher());
  const history = new QueryHistoryStore(join(userData, "query-history.json"));
  const providers = new ProviderRegistry();
  providers.register(new MySqlWorkbenchProvider());
  return new DesktopServices(profiles, credentials, new ConnectionManager(providers), history);
}

function createSafeStorageCipher(): SecretCipher {
  return {
    isAvailable: () => { if (!safeStorage.isEncryptionAvailable()) return false; if (process.platform !== "linux") return true; const backend = safeStorage.getSelectedStorageBackend(); return backend !== "basic_text" && backend !== "unknown"; },
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  };
}

async function createWindow(): Promise<void> {
  const preloadScript = resolve(currentDirectory, "../preload/preload.cjs");
  const rendererHtml = join(rendererRoot, "index.html");
  const diagnostics: string[] = [];
  let rendererReady = false;
  let readinessTimer: ReturnType<typeof setTimeout> | undefined;
  const window = new BrowserWindow({ width: 1480, height: 920, minWidth: 1080, minHeight: 700, title: "NuBlox SQL Workbench", backgroundColor: "#0f172a", show: true, webPreferences: { preload: preloadScript, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  const recordDiagnostic = (detail: string): void => { diagnostics.push(detail); if (diagnostics.length > 12) diagnostics.shift(); console.error(detail); void logStartup(detail); };

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("console-message", (details) => { if (details.level !== "warning" && details.level !== "error") return; const source = details.sourceId ? ` · ${details.sourceId}:${details.lineNumber}` : ""; recordDiagnostic(`Renderer console ${details.level}: ${details.message}${source}`); });
  window.webContents.on("preload-error", (_event, preloadPath, error) => { recordDiagnostic(`Preload failed at '${preloadPath}': ${errorMessage(error)}`); });
  window.webContents.on("ipc-message", (_event, channel) => { if (channel !== IPC.rendererReady) return; rendererReady = true; if (readinessTimer) clearTimeout(readinessTimer); void logStartup("Renderer application mounted successfully."); });
  window.webContents.on("render-process-gone", (_event, details) => { const detail = `Renderer process exited: ${details.reason}${details.exitCode !== 0 ? ` (code ${details.exitCode})` : ""}.`; recordDiagnostic(detail); void showRendererFailure(window, "The SQL Workbench renderer stopped unexpectedly", [detail]); });
  window.webContents.on("did-fail-load", (_event, code, description, validatedUrl, isMainFrame) => { if (!isMainFrame) return; recordDiagnostic(`Renderer navigation failed (${code}): ${description}${validatedUrl ? ` · ${validatedUrl}` : ""}`); });
  window.on("closed", () => { if (readinessTimer) clearTimeout(readinessTimer); });

  const check = await verifyRendererBootstrap({ rendererHtml, preloadScript });
  if (!check.ok) { for (const error of check.errors) recordDiagnostic(error); await showRendererFailure(window, "SQL Workbench could not load its desktop UI", check.errors); return; }

  try {
    await logStartup(`Loading renderer '${RENDERER_URL}' from '${rendererRoot}'.`);
    await window.loadURL(RENDERER_URL);
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    await logStartup("Renderer document loaded; waiting for Svelte application mount.");
    if (!rendererReady) readinessTimer = setTimeout(() => { if (rendererReady || window.isDestroyed()) return; const details = [`Renderer document loaded, but the Svelte application did not report a successful mount within ${RENDERER_READY_TIMEOUT_MS / 1000} seconds.`, ...diagnostics.slice(-8)]; void logStartup(details[0]!); void showRendererFailure(window, "SQL Workbench renderer failed to mount", details); }, RENDERER_READY_TIMEOUT_MS);
  } catch (error) {
    const detail = `Unable to load renderer '${RENDERER_URL}': ${errorMessage(error)}`;
    recordDiagnostic(detail); await showRendererFailure(window, "SQL Workbench could not load its desktop UI", [detail]);
  }
}

async function showRendererFailure(window: BrowserWindow, title: string, details: readonly string[]): Promise<void> { if (window.isDestroyed()) return; await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(rendererFailureHtml(title, details))}`).catch((error: unknown) => console.error("Unable to show renderer failure page.", error)); if (!window.isVisible()) window.show(); }
async function logStartup(message: string): Promise<void> { try { const directory = app.getPath("userData"); await mkdir(directory, { recursive: true }); await appendFile(join(directory, "startup.log"), `${new Date().toISOString()} ${message}\n`, "utf8"); } catch { /* Startup logging must never prevent launch. */ } }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function registerIpc(desktop: DesktopServices): void {
  const planHistory = new QueryPlanHistoryStore(join(app.getPath("userData"), "query-plan-history.json"));
  const statistics = new QueryStatisticsService(desktop.history, planHistory);
  const administration = new DesktopAdministrationService(desktop.connections);
  const queryLanguage = new DesktopQueryLanguageService(desktop.connections);
  const explain = new DesktopExplainService(desktop.connections, planHistory, statistics);
  const schema = new DesktopSchemaService(desktop.connections);
  const views = new DesktopViewService(desktop.connections);
  const er = new DesktopErService(desktop.connections);

  ipcMain.handle(IPC.profilesList, () => desktop.listProfiles()); ipcMain.handle(IPC.profilesSave, (_event, request: SaveProfileRequest) => desktop.saveProfile(request)); ipcMain.handle(IPC.profilesRemove, (_event, request: DeleteProfileRequest) => desktop.removeProfile(request)); ipcMain.handle(IPC.profilesClearCredential, (_event, profileId: string) => desktop.clearCredential(profileId));
  ipcMain.handle(IPC.connectionsList, () => desktop.listConnections()); ipcMain.handle(IPC.connectionsConnect, (_event, profileId: string) => desktop.connectProfile(profileId)); ipcMain.handle(IPC.connectionsDisconnect, (_event, profileId: string) => desktop.disconnectProfile(profileId));
  ipcMain.handle(IPC.administrationSessions, (_event, connectionId: string) => administration.listSessions(connectionId)); ipcMain.handle(IPC.administrationLocks, (_event, connectionId: string) => administration.listLockWaits(connectionId)); ipcMain.handle(IPC.administrationVariables, (_event, request: AdministrationValueRequest) => administration.listVariables(request.connectionId, request.filter)); ipcMain.handle(IPC.administrationStatus, (_event, request: AdministrationValueRequest) => administration.listStatus(request.connectionId, request.filter));
  ipcMain.handle(IPC.operationsAccounts, (_event, connectionId: string) => administration.listAccounts(connectionId));
  ipcMain.handle(IPC.operationsRoles, (_event, connectionId: string) => administration.listRoleMemberships(connectionId));
  ipcMain.handle(IPC.operationsPrivileges, (_event, connectionId: string, grantee?: string) => administration.listPrivilegeGrants(connectionId, grantee));
  ipcMain.handle(IPC.operationsSecurityPreview, (_event, request: SecurityPreviewRequest) => administration.previewSecurityChange(request.connectionId, request.change));
  ipcMain.handle(IPC.operationsSecurityExecute, (_event, request: SecurityExecuteRequest) => administration.executeSecurityChange(request.connectionId, request.change, request.confirmation));
  ipcMain.handle(IPC.operationsStorage, (_event, connectionId: string) => administration.listStorage(connectionId));
  ipcMain.handle(IPC.operationsExport, (_event, request: TableExportRequest) => exportAdministrationTable(administration, request));
  ipcMain.handle(IPC.operationsImport, (_event, request: TableImportRequest) => importAdministrationTable(administration, request));
  ipcMain.handle(IPC.operationsCompare, (_event, request: CompareRequest) => administration.compareTables(request.connectionId, request));
  ipcMain.handle(IPC.operationsTransfer, (_event, request: TransferRequest) => administration.transferTable(request.connectionId, request, request.confirmation));
  ipcMain.handle(IPC.operationsBackupHooks, (_event, connectionId: string) => administration.listBackupHooks(connectionId));
  ipcMain.handle(IPC.explorerNamespaces, (_event, request: ExplorerNamespaceRequest) => desktop.listExplorerNamespaces(request)); ipcMain.handle(IPC.explorerRelations, (_event, request: ExplorerRelationRequest) => desktop.listExplorerRelations(request)); ipcMain.handle(IPC.explorerDescribe, (_event, request: ExplorerRelationDetailsRequest) => desktop.describeExplorerRelation(request)); ipcMain.handle(IPC.explorerRoutines, (_event, request: ExplorerRelationRequest) => desktop.listExplorerRoutines(request)); ipcMain.handle(IPC.explorerTriggers, (_event, request: ExplorerRelationRequest) => desktop.listExplorerTriggers(request)); ipcMain.handle(IPC.explorerEvents, (_event, request: ExplorerRelationRequest) => desktop.listExplorerEvents(request)); ipcMain.handle(IPC.explorerPrincipals, (_event, connectionId: string) => desktop.listExplorerPrincipals(connectionId)); ipcMain.handle(IPC.explorerRoles, (_event, connectionId: string) => desktop.listExplorerRoleGrants(connectionId)); ipcMain.handle(IPC.explorerPrivileges, (_event, request: ExplorerPrivilegeRequest) => desktop.listExplorerPrivileges(request)); ipcMain.handle(IPC.explorerSearch, (_event, request: ExplorerSearchRequest) => desktop.searchExplorer(request));
  ipcMain.handle(IPC.queryLanguageCatalog, (_event, connectionId: string) => queryLanguage.catalog(connectionId)); ipcMain.handle(IPC.schemaLoad, (_event, request: SchemaLoadRequest) => schema.load(request)); ipcMain.handle(IPC.schemaPreview, (_event, request: SchemaPreviewRequest) => schema.preview(request)); ipcMain.handle(IPC.schemaGraph, (_event, request: SchemaGraphRequest) => schema.graph(request)); ipcMain.handle(IPC.schemaExecute, (_event, request: SchemaExecuteRequest) => schema.execute(request));
  ipcMain.handle(IPC.viewLoad, (_event, request: ViewLoadRequest) => views.load(request)); ipcMain.handle(IPC.viewPreview, (_event, request: ViewPreviewRequest) => views.preview(request)); ipcMain.handle(IPC.viewExecute, (_event, request: ViewExecuteRequest) => views.execute(request)); ipcMain.handle(IPC.erPreview, (_event, request: ErRelationshipRequest) => er.preview(request)); ipcMain.handle(IPC.erExecute, (_event, request: ErExecuteRequest) => er.execute(request));
  ipcMain.handle(IPC.queriesExecute, (_event, request: ExecuteQueryRequest) => desktop.executeQuery(request)); ipcMain.handle(IPC.queriesExplain, (_event, request: ExplainQueryRequest) => explain.explain(request)); ipcMain.handle(IPC.queriesCancel, (_event, executionId: string) => desktop.cancelQuery(executionId));
  ipcMain.handle(IPC.historyList, (_event, limit?: number) => desktop.listHistory(limit)); ipcMain.handle(IPC.historyClear, () => desktop.clearHistory());
  ipcMain.handle(IPC.planHistoryList, async (_event, request?: QueryPlanHistoryListRequest) => { const limit = request?.limit ?? 100; const entries = await planHistory.list(limit); return entries.filter((entry) => (!request?.connectionId || entry.connectionId === request.connectionId) && (!request?.sqlFingerprint || entry.sqlFingerprint === request.sqlFingerprint)); });
  ipcMain.handle(IPC.planHistoryClear, () => planHistory.clear()); ipcMain.handle(IPC.queryStatistics, (_event, request: QueryStatisticsRequest) => statistics.forQuery(request.connectionId, request.sql));
  ipcMain.handle(IPC.resultsExport, (_event, request: ExportResultRequest) => exportResult(request)); ipcMain.handle(IPC.appVersion, () => app.getVersion());
}

async function exportAdministrationTable(administration: DesktopAdministrationService, request: TableExportRequest): Promise<TableExportResponse> {
  const data = await administration.exportTable(request.connectionId, request.catalog, request.table, request.limit);
  const result = await dialog.showSaveDialog({ title: "Export table as Workbench JSON", defaultPath: sanitizeFileName(`${request.catalog}-${request.table}.json`), filters: [{ name: "Workbench JSON", extensions: ["json"] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  await writeFile(result.filePath, JSON.stringify(data, jsonReplacer, 2), { encoding: "utf8", mode: 0o600 });
  return { canceled: false, path: result.filePath, rows: data.rows.length };
}

async function importAdministrationTable(administration: DesktopAdministrationService, request: TableImportRequest): Promise<TableImportResponse> {
  const chosen = await dialog.showOpenDialog({ title: "Import Workbench table JSON", properties: ["openFile"], filters: [{ name: "Workbench JSON", extensions: ["json"] }] });
  const filePath = chosen.filePaths[0];
  if (chosen.canceled || !filePath) return { canceled: true };
  const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
  const data = parseTableData(parsed, request.catalog, request.table);
  const result = await administration.importTable(request.connectionId, data, request.truncateTarget ?? false);
  return { canceled: false, path: filePath, result };
}

function parseTableData(value: unknown, catalogOverride?: string, tableOverride?: string): DatabaseTableData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Workbench import file must contain a table-data object.");
  const record = value as Record<string, unknown>;
  const catalog = (catalogOverride ?? (typeof record.catalog === "string" ? record.catalog : "")).trim();
  const table = (tableOverride ?? (typeof record.table === "string" ? record.table : "")).trim();
  const columns = Array.isArray(record.columns) && record.columns.every((item) => typeof item === "string") ? record.columns : [];
  const rows = Array.isArray(record.rows) && record.rows.every((item) => item && typeof item === "object" && !Array.isArray(item)) ? record.rows as Readonly<Record<string, unknown>>[] : [];
  if (!catalog || !table || columns.length === 0) throw new Error("Workbench import file must contain catalog, table and columns.");
  return { catalog, table, columns, rows };
}

async function exportResult(request: ExportResultRequest): Promise<ExportResultResponse> {
  const extension = request.format === "csv" ? "csv" : "json";
  const safeName = sanitizeFileName(request.suggestedName || `query-result.${extension}`);
  const defaultPath = safeName.toLowerCase().endsWith(`.${extension}`) ? safeName : `${safeName}.${extension}`;
  const result = await dialog.showSaveDialog({ title: `Export query results as ${extension.toUpperCase()}`, defaultPath, filters: request.format === "csv" ? [{ name: "CSV files", extensions: ["csv"] }] : [{ name: "JSON files", extensions: ["json"] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  await writeFile(result.filePath, request.format === "csv" ? serializeResultSetCsv(request.resultSet) : serializeResultSetJson(request.resultSet), { encoding: "utf8", mode: 0o600 });
  return { canceled: false, path: result.filePath };
}

function jsonReplacer(_key: string, value: unknown): unknown { return typeof value === "bigint" ? value.toString() : value; }
function sanitizeFileName(value: string): string { const normalized = value.trim().replace(/[\\/:*?"<>|]/gu, "_"); return normalized || "query-result"; }

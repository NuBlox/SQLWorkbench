import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import { JsonConnectionProfileRepository } from "@nublox/workbench-connection-profiles";
import { ConnectionManager, ProviderRegistry } from "@nublox/workbench-core";
import { MySqlWorkbenchProvider } from "@nublox/workbench-provider-mysql/workbench";

import type {
  DeleteProfileRequest, ErExecuteRequest, ErRelationshipRequest, ExecuteQueryRequest, ExplainQueryRequest,
  ExplorerNamespaceRequest, ExplorerPrivilegeRequest, ExplorerRelationDetailsRequest, ExplorerRelationRequest,
  ExplorerSearchRequest, ExportResultRequest, ExportResultResponse, QueryPlanHistoryListRequest, QueryStatisticsRequest,
  SaveProfileRequest, SchemaExecuteRequest, SchemaGraphRequest, SchemaLoadRequest, SchemaPreviewRequest,
  ViewExecuteRequest, ViewLoadRequest, ViewPreviewRequest,
} from "../lib/desktop-api.js";
import { EncryptedFileCredentialStore, type SecretCipher } from "./encrypted-credential-store.js";
import { DesktopErService } from "./er-service.js";
import { DesktopExplainService } from "./explain-service.js";
import { QueryPlanHistoryStore } from "./plan-history-store.js";
import { QueryHistoryStore } from "./query-history-store.js";
import { DesktopQueryLanguageService } from "./query-language-service.js";
import { QueryStatisticsService } from "./query-statistics-service.js";
import { rendererFailureHtml, verifyRendererBootstrap } from "./renderer-bootstrap.js";
import { serializeResultSetCsv, serializeResultSetJson } from "./result-export.js";
import { DesktopSchemaService } from "./schema-service.js";
import { DesktopServices } from "./services.js";
import { DesktopViewService } from "./view-service.js";

const IPC = Object.freeze({
  profilesList: "nublox:profiles:list", profilesSave: "nublox:profiles:save", profilesRemove: "nublox:profiles:remove", profilesClearCredential: "nublox:profiles:clear-credential",
  connectionsList: "nublox:connections:list", connectionsConnect: "nublox:connections:connect", connectionsDisconnect: "nublox:connections:disconnect",
  explorerNamespaces: "nublox:explorer:namespaces", explorerRelations: "nublox:explorer:relations", explorerDescribe: "nublox:explorer:describe", explorerRoutines: "nublox:explorer:routines", explorerTriggers: "nublox:explorer:triggers", explorerEvents: "nublox:explorer:events", explorerPrincipals: "nublox:explorer:principals", explorerRoles: "nublox:explorer:roles", explorerPrivileges: "nublox:explorer:privileges", explorerSearch: "nublox:explorer:search",
  queryLanguageCatalog: "nublox:query-language:catalog", schemaLoad: "nublox:schema:load", schemaPreview: "nublox:schema:preview", schemaGraph: "nublox:schema:graph", schemaExecute: "nublox:schema:execute",
  viewLoad: "nublox:views:load", viewPreview: "nublox:views:preview", viewExecute: "nublox:views:execute", erPreview: "nublox:er:preview", erExecute: "nublox:er:execute",
  queriesExecute: "nublox:queries:execute", queriesExplain: "nublox:queries:explain", queriesCancel: "nublox:queries:cancel",
  historyList: "nublox:history:list", historyClear: "nublox:history:clear", planHistoryList: "nublox:plan-history:list", planHistoryClear: "nublox:plan-history:clear", queryStatistics: "nublox:statistics:query",
  resultsExport: "nublox:results:export", appVersion: "nublox:app:version",
});

const currentDirectory = dirname(fileURLToPath(import.meta.url));
let services: DesktopServices | undefined;
let allowQuit = false;
app.setName("NuBlox SQL Workbench");

app.whenReady().then(async () => {
  await logStartup("Electron ready.");
  services = createServices(); registerIpc(services); await createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow(); });
}).catch((error: unknown) => {
  const detail = errorMessage(error); console.error("Failed to start NuBlox SQL Workbench.", error); void logStartup(`Fatal application startup failure: ${detail}`); dialog.showErrorBox("NuBlox SQL Workbench failed to start", detail); app.quit();
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", (event) => {
  if (allowQuit || !services) return;
  event.preventDefault(); allowQuit = true; services.cancelAllQueries();
  void services.connections.disconnectAll().catch((error: unknown) => console.error("Failed to close one or more database sessions.", error)).finally(() => app.quit());
});

function createServices(): DesktopServices {
  const userData = app.getPath("userData");
  const profiles = new JsonConnectionProfileRepository(join(userData, "connection-profiles.json"));
  const credentials = new EncryptedFileCredentialStore(join(userData, "connection-credentials.json"), createSafeStorageCipher());
  const history = new QueryHistoryStore(join(userData, "query-history.json"));
  const providers = new ProviderRegistry(); providers.register(new MySqlWorkbenchProvider());
  return new DesktopServices(profiles, credentials, new ConnectionManager(providers), history);
}
function createSafeStorageCipher(): SecretCipher {
  return { isAvailable: () => { if (!safeStorage.isEncryptionAvailable()) return false; if (process.platform !== "linux") return true; const backend = safeStorage.getSelectedStorageBackend(); return backend !== "basic_text" && backend !== "unknown"; }, encrypt: (value) => safeStorage.encryptString(value), decrypt: (value) => safeStorage.decryptString(value) };
}

async function createWindow(): Promise<void> {
  const preloadScript = resolve(currentDirectory, "../preload/preload.cjs"); const rendererHtml = resolve(currentDirectory, "../../../build/renderer/index.html");
  const window = new BrowserWindow({ width: 1480, height: 920, minWidth: 1080, minHeight: 700, title: "NuBlox SQL Workbench", backgroundColor: "#0f172a", show: true, webPreferences: { preload: preloadScript, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("render-process-gone", (_event, details) => { const detail = `Renderer process exited: ${details.reason}${details.exitCode !== 0 ? ` (code ${details.exitCode})` : ""}.`; console.error(detail); void logStartup(detail); void showRendererFailure(window, "The SQL Workbench renderer stopped unexpectedly", [detail]); });
  window.webContents.on("did-fail-load", (_event, code, description, validatedUrl, isMainFrame) => { if (!isMainFrame) return; const detail = `Renderer navigation failed (${code}): ${description}${validatedUrl ? ` · ${validatedUrl}` : ""}`; console.error(detail); void logStartup(detail); });
  const check = await verifyRendererBootstrap({ rendererHtml, preloadScript });
  if (!check.ok) { for (const error of check.errors) { console.error(error); await logStartup(error); } await showRendererFailure(window, "SQL Workbench could not load its desktop UI", check.errors); return; }
  try { await logStartup(`Loading renderer '${rendererHtml}'.`); await window.loadFile(rendererHtml); window.webContents.on("will-navigate", (event) => event.preventDefault()); await logStartup("Renderer loaded successfully."); }
  catch (error) { const detail = `Unable to load renderer '${rendererHtml}': ${errorMessage(error)}`; console.error(detail); await logStartup(detail); await showRendererFailure(window, "SQL Workbench could not load its desktop UI", [detail]); }
}
async function showRendererFailure(window: BrowserWindow, title: string, details: readonly string[]): Promise<void> { if (window.isDestroyed()) return; await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(rendererFailureHtml(title, details))}`).catch((error: unknown) => console.error("Unable to show renderer failure page.", error)); if (!window.isVisible()) window.show(); }
async function logStartup(message: string): Promise<void> { try { const directory = app.getPath("userData"); await mkdir(directory, { recursive: true }); await appendFile(join(directory, "startup.log"), `${new Date().toISOString()} ${message}\n`, "utf8"); } catch {} }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function registerIpc(desktop: DesktopServices): void {
  const planHistory = new QueryPlanHistoryStore(join(app.getPath("userData"), "query-plan-history.json"));
  const statistics = new QueryStatisticsService(desktop.history, planHistory);
  const queryLanguage = new DesktopQueryLanguageService(desktop.connections); const explain = new DesktopExplainService(desktop.connections, planHistory); const schema = new DesktopSchemaService(desktop.connections); const views = new DesktopViewService(desktop.connections); const er = new DesktopErService(desktop.connections);
  ipcMain.handle(IPC.profilesList, () => desktop.listProfiles()); ipcMain.handle(IPC.profilesSave, (_event, request: SaveProfileRequest) => desktop.saveProfile(request)); ipcMain.handle(IPC.profilesRemove, (_event, request: DeleteProfileRequest) => desktop.removeProfile(request)); ipcMain.handle(IPC.profilesClearCredential, (_event, profileId: string) => desktop.clearCredential(profileId));
  ipcMain.handle(IPC.connectionsList, () => desktop.listConnections()); ipcMain.handle(IPC.connectionsConnect, (_event, profileId: string) => desktop.connectProfile(profileId)); ipcMain.handle(IPC.connectionsDisconnect, (_event, profileId: string) => desktop.disconnectProfile(profileId));
  ipcMain.handle(IPC.explorerNamespaces, (_event, request: ExplorerNamespaceRequest) => desktop.listExplorerNamespaces(request)); ipcMain.handle(IPC.explorerRelations, (_event, request: ExplorerRelationRequest) => desktop.listExplorerRelations(request)); ipcMain.handle(IPC.explorerDescribe, (_event, request: ExplorerRelationDetailsRequest) => desktop.describeExplorerRelation(request)); ipcMain.handle(IPC.explorerRoutines, (_event, request: ExplorerRelationRequest) => desktop.listExplorerRoutines(request)); ipcMain.handle(IPC.explorerTriggers, (_event, request: ExplorerRelationRequest) => desktop.listExplorerTriggers(request)); ipcMain.handle(IPC.explorerEvents, (_event, request: ExplorerRelationRequest) => desktop.listExplorerEvents(request)); ipcMain.handle(IPC.explorerPrincipals, (_event, connectionId: string) => desktop.listExplorerPrincipals(connectionId)); ipcMain.handle(IPC.explorerRoles, (_event, connectionId: string) => desktop.listExplorerRoleGrants(connectionId)); ipcMain.handle(IPC.explorerPrivileges, (_event, request: ExplorerPrivilegeRequest) => desktop.listExplorerPrivileges(request)); ipcMain.handle(IPC.explorerSearch, (_event, request: ExplorerSearchRequest) => desktop.searchExplorer(request));
  ipcMain.handle(IPC.queryLanguageCatalog, (_event, connectionId: string) => queryLanguage.catalog(connectionId)); ipcMain.handle(IPC.schemaLoad, (_event, request: SchemaLoadRequest) => schema.load(request)); ipcMain.handle(IPC.schemaPreview, (_event, request: SchemaPreviewRequest) => schema.preview(request)); ipcMain.handle(IPC.schemaGraph, (_event, request: SchemaGraphRequest) => schema.graph(request)); ipcMain.handle(IPC.schemaExecute, (_event, request: SchemaExecuteRequest) => schema.execute(request));
  ipcMain.handle(IPC.viewLoad, (_event, request: ViewLoadRequest) => views.load(request)); ipcMain.handle(IPC.viewPreview, (_event, request: ViewPreviewRequest) => views.preview(request)); ipcMain.handle(IPC.viewExecute, (_event, request: ViewExecuteRequest) => views.execute(request)); ipcMain.handle(IPC.erPreview, (_event, request: ErRelationshipRequest) => er.preview(request)); ipcMain.handle(IPC.erExecute, (_event, request: ErExecuteRequest) => er.execute(request));
  ipcMain.handle(IPC.queriesExecute, (_event, request: ExecuteQueryRequest) => desktop.executeQuery(request)); ipcMain.handle(IPC.queriesExplain, (_event, request: ExplainQueryRequest) => explain.explain(request)); ipcMain.handle(IPC.queriesCancel, (_event, executionId: string) => desktop.cancelQuery(executionId));
  ipcMain.handle(IPC.historyList, (_event, limit?: number) => desktop.listHistory(limit)); ipcMain.handle(IPC.historyClear, () => desktop.clearHistory());
  ipcMain.handle(IPC.planHistoryList, async (_event, request?: QueryPlanHistoryListRequest) => { const limit = request?.limit ?? 100; const entries = await planHistory.list(limit); return entries.filter((entry) => (!request?.connectionId || entry.connectionId === request.connectionId) && (!request?.sqlFingerprint || entry.sqlFingerprint === request.sqlFingerprint)); });
  ipcMain.handle(IPC.planHistoryClear, () => planHistory.clear()); ipcMain.handle(IPC.queryStatistics, (_event, request: QueryStatisticsRequest) => statistics.forQuery(request.connectionId, request.sql));
  ipcMain.handle(IPC.resultsExport, (_event, request: ExportResultRequest) => exportResult(request)); ipcMain.handle(IPC.appVersion, () => app.getVersion());
}

async function exportResult(request: ExportResultRequest): Promise<ExportResultResponse> {
  const extension = request.format === "csv" ? "csv" : "json"; const safeName = sanitizeFileName(request.suggestedName || `query-result.${extension}`); const defaultPath = safeName.toLowerCase().endsWith(`.${extension}`) ? safeName : `${safeName}.${extension}`;
  const result = await dialog.showSaveDialog({ title: `Export query results as ${extension.toUpperCase()}`, defaultPath, filters: request.format === "csv" ? [{ name: "CSV files", extensions: ["csv"] }] : [{ name: "JSON files", extensions: ["json"] }] });
  if (result.canceled || !result.filePath) return { canceled: true };
  await writeFile(result.filePath, request.format === "csv" ? serializeResultSetCsv(request.resultSet) : serializeResultSetJson(request.resultSet), { encoding: "utf8", mode: 0o600 }); return { canceled: false, path: result.filePath };
}
function sanitizeFileName(value: string): string { const normalized = value.trim().replace(/[\\/:*?"<>|]/gu, "_"); return normalized || "query-result"; }

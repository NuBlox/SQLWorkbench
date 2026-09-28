import { contextBridge, ipcRenderer } from "electron";

import type {
  AdministrationValueRequest,
  DeleteProfileRequest,
  DesktopApi,
  ErExecuteRequest,
  ErRelationshipRequest,
  ExecuteQueryRequest,
  ExplainQueryRequest,
  ExplorerNamespaceRequest,
  ExplorerPrivilegeRequest,
  ExplorerRelationDetailsRequest,
  ExplorerRelationRequest,
  ExplorerSearchRequest,
  ExportResultRequest,
  QueryPlanHistoryListRequest,
  QueryStatisticsRequest,
  SaveProfileRequest,
  SchemaExecuteRequest,
  SchemaGraphRequest,
  SchemaLoadRequest,
  SchemaPreviewRequest,
  ViewExecuteRequest,
  ViewLoadRequest,
  ViewPreviewRequest,
} from "../lib/desktop-api.js";

const IPC = Object.freeze({
  profilesList: "nublox:profiles:list", profilesSave: "nublox:profiles:save", profilesRemove: "nublox:profiles:remove", profilesClearCredential: "nublox:profiles:clear-credential",
  connectionsList: "nublox:connections:list", connectionsConnect: "nublox:connections:connect", connectionsDisconnect: "nublox:connections:disconnect",
  administrationSessions: "nublox:administration:sessions", administrationLocks: "nublox:administration:locks", administrationVariables: "nublox:administration:variables", administrationStatus: "nublox:administration:status",
  explorerNamespaces: "nublox:explorer:namespaces", explorerRelations: "nublox:explorer:relations", explorerDescribe: "nublox:explorer:describe", explorerRoutines: "nublox:explorer:routines", explorerTriggers: "nublox:explorer:triggers", explorerEvents: "nublox:explorer:events", explorerPrincipals: "nublox:explorer:principals", explorerRoles: "nublox:explorer:roles", explorerPrivileges: "nublox:explorer:privileges", explorerSearch: "nublox:explorer:search",
  queryLanguageCatalog: "nublox:query-language:catalog", schemaLoad: "nublox:schema:load", schemaPreview: "nublox:schema:preview", schemaGraph: "nublox:schema:graph", schemaExecute: "nublox:schema:execute",
  viewLoad: "nublox:views:load", viewPreview: "nublox:views:preview", viewExecute: "nublox:views:execute", erPreview: "nublox:er:preview", erExecute: "nublox:er:execute",
  queriesExecute: "nublox:queries:execute", queriesExplain: "nublox:queries:explain", queriesCancel: "nublox:queries:cancel",
  historyList: "nublox:history:list", historyClear: "nublox:history:clear", planHistoryList: "nublox:plan-history:list", planHistoryClear: "nublox:plan-history:clear", queryStatistics: "nublox:statistics:query",
  resultsExport: "nublox:results:export", appVersion: "nublox:app:version", rendererReady: "nublox:renderer:ready",
});

const api: DesktopApi = Object.freeze({
  profiles: Object.freeze({
    list: () => ipcRenderer.invoke(IPC.profilesList),
    save: (request: SaveProfileRequest) => ipcRenderer.invoke(IPC.profilesSave, request),
    remove: (request: DeleteProfileRequest) => ipcRenderer.invoke(IPC.profilesRemove, request),
    clearCredential: (profileId: string) => ipcRenderer.invoke(IPC.profilesClearCredential, profileId),
  }),
  connections: Object.freeze({
    list: () => ipcRenderer.invoke(IPC.connectionsList),
    connect: (profileId: string) => ipcRenderer.invoke(IPC.connectionsConnect, profileId),
    disconnect: (profileId: string) => ipcRenderer.invoke(IPC.connectionsDisconnect, profileId),
  }),
  administration: Object.freeze({
    sessions: (connectionId: string) => ipcRenderer.invoke(IPC.administrationSessions, connectionId),
    locks: (connectionId: string) => ipcRenderer.invoke(IPC.administrationLocks, connectionId),
    variables: (request: AdministrationValueRequest) => ipcRenderer.invoke(IPC.administrationVariables, request),
    status: (request: AdministrationValueRequest) => ipcRenderer.invoke(IPC.administrationStatus, request),
  }),
  explorer: Object.freeze({
    namespaces: (request: ExplorerNamespaceRequest) => ipcRenderer.invoke(IPC.explorerNamespaces, request),
    relations: (request: ExplorerRelationRequest) => ipcRenderer.invoke(IPC.explorerRelations, request),
    describe: (request: ExplorerRelationDetailsRequest) => ipcRenderer.invoke(IPC.explorerDescribe, request),
    routines: (request: ExplorerRelationRequest) => ipcRenderer.invoke(IPC.explorerRoutines, request),
    triggers: (request: ExplorerRelationRequest) => ipcRenderer.invoke(IPC.explorerTriggers, request),
    events: (request: ExplorerRelationRequest) => ipcRenderer.invoke(IPC.explorerEvents, request),
    principals: (connectionId: string) => ipcRenderer.invoke(IPC.explorerPrincipals, connectionId),
    roles: (connectionId: string) => ipcRenderer.invoke(IPC.explorerRoles, connectionId),
    privileges: (request: ExplorerPrivilegeRequest) => ipcRenderer.invoke(IPC.explorerPrivileges, request),
    search: (request: ExplorerSearchRequest) => ipcRenderer.invoke(IPC.explorerSearch, request),
  }),
  queryLanguage: Object.freeze({ catalog: (connectionId: string) => ipcRenderer.invoke(IPC.queryLanguageCatalog, connectionId) }),
  schema: Object.freeze({
    load: (request: SchemaLoadRequest) => ipcRenderer.invoke(IPC.schemaLoad, request),
    preview: (request: SchemaPreviewRequest) => ipcRenderer.invoke(IPC.schemaPreview, request),
    graph: (request: SchemaGraphRequest) => ipcRenderer.invoke(IPC.schemaGraph, request),
    execute: (request: SchemaExecuteRequest) => ipcRenderer.invoke(IPC.schemaExecute, request),
  }),
  views: Object.freeze({
    load: (request: ViewLoadRequest) => ipcRenderer.invoke(IPC.viewLoad, request),
    preview: (request: ViewPreviewRequest) => ipcRenderer.invoke(IPC.viewPreview, request),
    execute: (request: ViewExecuteRequest) => ipcRenderer.invoke(IPC.viewExecute, request),
  }),
  er: Object.freeze({ preview: (request: ErRelationshipRequest) => ipcRenderer.invoke(IPC.erPreview, request), execute: (request: ErExecuteRequest) => ipcRenderer.invoke(IPC.erExecute, request) }),
  queries: Object.freeze({
    execute: (request: ExecuteQueryRequest) => ipcRenderer.invoke(IPC.queriesExecute, request),
    explain: (request: ExplainQueryRequest) => ipcRenderer.invoke(IPC.queriesExplain, request),
    cancel: (executionId: string) => ipcRenderer.invoke(IPC.queriesCancel, executionId),
  }),
  history: Object.freeze({ list: (limit?: number) => ipcRenderer.invoke(IPC.historyList, limit), clear: () => ipcRenderer.invoke(IPC.historyClear) }),
  planHistory: Object.freeze({ list: (request?: QueryPlanHistoryListRequest) => ipcRenderer.invoke(IPC.planHistoryList, request), clear: () => ipcRenderer.invoke(IPC.planHistoryClear) }),
  statistics: Object.freeze({ forQuery: (request: QueryStatisticsRequest) => ipcRenderer.invoke(IPC.queryStatistics, request) }),
  results: Object.freeze({ export: (request: ExportResultRequest) => ipcRenderer.invoke(IPC.resultsExport, request) }),
  app: Object.freeze({
    version: () => ipcRenderer.invoke(IPC.appVersion),
    rendererReady: () => ipcRenderer.send(IPC.rendererReady),
  }),
});

contextBridge.exposeInMainWorld("nublox", api);

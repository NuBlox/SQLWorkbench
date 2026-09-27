import { contextBridge, ipcRenderer } from "electron";

import type {
  DeleteProfileRequest,
  DesktopApi,
  ExecuteQueryRequest,
  ExplorerNamespaceRequest,
  ExplorerPrivilegeRequest,
  ExplorerRelationDetailsRequest,
  ExplorerRelationRequest,
  ExplorerSearchRequest,
  ExportResultRequest,
  SaveProfileRequest,
  SchemaExecuteRequest,
  SchemaGraphRequest,
  SchemaLoadRequest,
  SchemaPreviewRequest,
} from "../lib/desktop-api.js";

const IPC = Object.freeze({
  profilesList: "nublox:profiles:list",
  profilesSave: "nublox:profiles:save",
  profilesRemove: "nublox:profiles:remove",
  profilesClearCredential: "nublox:profiles:clear-credential",
  connectionsList: "nublox:connections:list",
  connectionsConnect: "nublox:connections:connect",
  connectionsDisconnect: "nublox:connections:disconnect",
  explorerNamespaces: "nublox:explorer:namespaces",
  explorerRelations: "nublox:explorer:relations",
  explorerDescribe: "nublox:explorer:describe",
  explorerRoutines: "nublox:explorer:routines",
  explorerTriggers: "nublox:explorer:triggers",
  explorerEvents: "nublox:explorer:events",
  explorerPrincipals: "nublox:explorer:principals",
  explorerRoles: "nublox:explorer:roles",
  explorerPrivileges: "nublox:explorer:privileges",
  explorerSearch: "nublox:explorer:search",
  schemaLoad: "nublox:schema:load",
  schemaPreview: "nublox:schema:preview",
  schemaGraph: "nublox:schema:graph",
  schemaExecute: "nublox:schema:execute",
  queriesExecute: "nublox:queries:execute",
  queriesCancel: "nublox:queries:cancel",
  historyList: "nublox:history:list",
  historyClear: "nublox:history:clear",
  resultsExport: "nublox:results:export",
  appVersion: "nublox:app:version",
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
  schema: Object.freeze({
    load: (request: SchemaLoadRequest) => ipcRenderer.invoke(IPC.schemaLoad, request),
    preview: (request: SchemaPreviewRequest) => ipcRenderer.invoke(IPC.schemaPreview, request),
    graph: (request: SchemaGraphRequest) => ipcRenderer.invoke(IPC.schemaGraph, request),
    execute: (request: SchemaExecuteRequest) => ipcRenderer.invoke(IPC.schemaExecute, request),
  }),
  queries: Object.freeze({
    execute: (request: ExecuteQueryRequest) => ipcRenderer.invoke(IPC.queriesExecute, request),
    cancel: (executionId: string) => ipcRenderer.invoke(IPC.queriesCancel, executionId),
  }),
  history: Object.freeze({
    list: (limit?: number) => ipcRenderer.invoke(IPC.historyList, limit),
    clear: () => ipcRenderer.invoke(IPC.historyClear),
  }),
  results: Object.freeze({
    export: (request: ExportResultRequest) => ipcRenderer.invoke(IPC.resultsExport, request),
  }),
  app: Object.freeze({ version: () => ipcRenderer.invoke(IPC.appVersion) }),
});

contextBridge.exposeInMainWorld("nublox", api);

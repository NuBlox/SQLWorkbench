import { contextBridge, ipcRenderer } from "electron";

import type {
  DeleteProfileRequest,
  DesktopApi,
  ExecuteQueryRequest,
  ExplorerNamespaceRequest,
  ExplorerRelationDetailsRequest,
  ExplorerRelationRequest,
  ExportResultRequest,
  SaveProfileRequest,
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
    clearCredential: (profileId: string) =>
      ipcRenderer.invoke(IPC.profilesClearCredential, profileId),
  }),
  connections: Object.freeze({
    list: () => ipcRenderer.invoke(IPC.connectionsList),
    connect: (profileId: string) => ipcRenderer.invoke(IPC.connectionsConnect, profileId),
    disconnect: (profileId: string) =>
      ipcRenderer.invoke(IPC.connectionsDisconnect, profileId),
  }),
  explorer: Object.freeze({
    namespaces: (request: ExplorerNamespaceRequest) =>
      ipcRenderer.invoke(IPC.explorerNamespaces, request),
    relations: (request: ExplorerRelationRequest) =>
      ipcRenderer.invoke(IPC.explorerRelations, request),
    describe: (request: ExplorerRelationDetailsRequest) =>
      ipcRenderer.invoke(IPC.explorerDescribe, request),
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
  app: Object.freeze({
    version: () => ipcRenderer.invoke(IPC.appVersion),
  }),
});

contextBridge.exposeInMainWorld("nublox", api);

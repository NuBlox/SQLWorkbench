import { contextBridge, ipcRenderer } from "electron";

import type {
  DeleteProfileRequest,
  DesktopApi,
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
  app: Object.freeze({
    version: () => ipcRenderer.invoke(IPC.appVersion),
  }),
});

contextBridge.exposeInMainWorld("nublox", api);

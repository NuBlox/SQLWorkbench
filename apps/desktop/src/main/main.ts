import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  ipcMain,
  safeStorage,
} from "electron";
import { JsonConnectionProfileRepository } from "@nublox/workbench-connection-profiles";
import { ConnectionManager, ProviderRegistry } from "@nublox/workbench-core";
import { MySqlDatabaseProvider } from "@nublox/workbench-provider-mysql";

import type {
  DeleteProfileRequest,
  SaveProfileRequest,
} from "../lib/desktop-api.js";
import {
  EncryptedFileCredentialStore,
  type SecretCipher,
} from "./encrypted-credential-store.js";
import { DesktopServices } from "./services.js";

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

const currentDirectory = dirname(fileURLToPath(import.meta.url));
let services: DesktopServices | undefined;
let allowQuit = false;

app.setName("NuBlox SQL Workbench");

app.whenReady().then(async () => {
  services = createServices();
  registerIpc(services);
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
    }
  });
}).catch((error: unknown) => {
  console.error("Failed to start NuBlox SQL Workbench.", error);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (allowQuit || !services) return;
  event.preventDefault();
  allowQuit = true;
  void services.connections.disconnectAll()
    .catch((error: unknown) => {
      console.error("Failed to close one or more database sessions.", error);
    })
    .finally(() => app.quit());
});

function createServices(): DesktopServices {
  const userData = app.getPath("userData");
  const profiles = new JsonConnectionProfileRepository(
    join(userData, "connection-profiles.json"),
  );
  const credentials = new EncryptedFileCredentialStore(
    join(userData, "connection-credentials.json"),
    createSafeStorageCipher(),
  );
  const providers = new ProviderRegistry();
  providers.register(new MySqlDatabaseProvider());
  const connections = new ConnectionManager(providers);
  return new DesktopServices(profiles, credentials, connections);
}

function createSafeStorageCipher(): SecretCipher {
  return {
    isAvailable: () => {
      if (!safeStorage.isEncryptionAvailable()) return false;
      if (process.platform !== "linux") return true;
      const backend = safeStorage.getSelectedStorageBackend();
      return backend !== "basic_text" && backend !== "unknown";
    },
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value),
  };
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 700,
    title: "NuBlox SQL Workbench",
    backgroundColor: "#0f172a",
    show: false,
    webPreferences: {
      preload: resolve(currentDirectory, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.once("ready-to-show", () => window.show());

  const renderer = resolve(currentDirectory, "../../../build/renderer/index.html");
  await window.loadFile(renderer);
  window.webContents.on("will-navigate", (event) => event.preventDefault());
}

function registerIpc(desktop: DesktopServices): void {
  ipcMain.handle(IPC.profilesList, () => desktop.listProfiles());
  ipcMain.handle(
    IPC.profilesSave,
    (_event, request: SaveProfileRequest) => desktop.saveProfile(request),
  );
  ipcMain.handle(
    IPC.profilesRemove,
    (_event, request: DeleteProfileRequest) => desktop.removeProfile(request),
  );
  ipcMain.handle(
    IPC.profilesClearCredential,
    (_event, profileId: string) => desktop.clearCredential(profileId),
  );
  ipcMain.handle(IPC.connectionsList, () => desktop.listConnections());
  ipcMain.handle(
    IPC.connectionsConnect,
    (_event, profileId: string) => desktop.connectProfile(profileId),
  );
  ipcMain.handle(
    IPC.connectionsDisconnect,
    (_event, profileId: string) => desktop.disconnectProfile(profileId),
  );
  ipcMain.handle(IPC.appVersion, () => app.getVersion());
}

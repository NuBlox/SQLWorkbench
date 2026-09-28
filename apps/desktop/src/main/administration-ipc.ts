import { dialog, ipcMain } from "electron";

import type {
  AdministrationBackupRequest,
  AdministrationCompareRequest,
  AdministrationDataFileRequest,
  AdministrationRestoreRequest,
  AdministrationSecurityChangeRequest,
  AdministrationSecurityExecuteRequest,
  AdministrationTableRequest,
  AdministrationTransferExecuteRequest,
  AdministrationTransferPreviewRequest,
} from "../lib/desktop-api.js";
import { DesktopOperationsService } from "./operations-service.js";
import type { DesktopServices } from "./services.js";

const IPC = Object.freeze({
  principals: "nublox:administration:principals",
  privileges: "nublox:administration:privileges",
  roles: "nublox:administration:roles",
  securityPreview: "nublox:administration:security-preview",
  securityExecute: "nublox:administration:security-execute",
  storage: "nublox:administration:storage",
  exportData: "nublox:administration:export-data",
  importData: "nublox:administration:import-data",
  compareData: "nublox:administration:compare-data",
  transferPreview: "nublox:administration:transfer-preview",
  transferExecute: "nublox:administration:transfer-execute",
  backup: "nublox:administration:backup",
  restore: "nublox:administration:restore",
});

export function registerAdministrationOperationsIpc(desktop: DesktopServices): void {
  const operations = new DesktopOperationsService(desktop.connections, desktop.profiles, desktop.credentials);

  ipcMain.handle(IPC.principals, (_event, connectionId: string) => operations.principals(connectionId));
  ipcMain.handle(IPC.privileges, (_event, connectionId: string, grantee?: string) => operations.privileges(connectionId, grantee));
  ipcMain.handle(IPC.roles, (_event, connectionId: string) => operations.roles(connectionId));
  ipcMain.handle(IPC.securityPreview, (_event, request: AdministrationSecurityChangeRequest) => operations.previewSecurity(request));
  ipcMain.handle(IPC.securityExecute, (_event, request: AdministrationSecurityExecuteRequest) => operations.executeSecurity(request));
  ipcMain.handle(IPC.storage, (_event, connectionId: string) => operations.storage(connectionId));
  ipcMain.handle(IPC.compareData, (_event, request: AdministrationCompareRequest) => operations.compareData(request));
  ipcMain.handle(IPC.transferPreview, (_event, request: AdministrationTransferPreviewRequest) => operations.previewTransfer(request));
  ipcMain.handle(IPC.transferExecute, (_event, request: AdministrationTransferExecuteRequest) => operations.executeTransfer(request));

  ipcMain.handle(IPC.exportData, async (_event, request: AdministrationDataFileRequest) => {
    const format = request.format ?? "json";
    const extension = format === "csv" ? "csv" : "json";
    const save = await dialog.showSaveDialog({
      title: `Export ${request.catalog}.${request.table}`,
      defaultPath: `${safeName(request.catalog)}-${safeName(request.table)}.${extension}`,
      filters: format === "csv" ? [{ name: "CSV files", extensions: ["csv"] }] : [{ name: "JSON files", extensions: ["json"] }],
    });
    if (save.canceled || !save.filePath) return { canceled: true, rowsRead: 0 };
    return operations.exportData(request, save.filePath, format);
  });

  ipcMain.handle(IPC.importData, async (_event, request: AdministrationTableRequest) => {
    const open = await dialog.showOpenDialog({ title: `Import into ${request.catalog}.${request.table}`, properties: ["openFile"], filters: [{ name: "JSON files", extensions: ["json"] }] });
    const path = open.filePaths[0];
    if (open.canceled || !path) return { canceled: true, rowsRead: 0 };
    return operations.importData(request, path);
  });

  ipcMain.handle(IPC.backup, async (_event, request: AdministrationBackupRequest) => {
    const save = await dialog.showSaveDialog({ title: `Backup ${request.catalog}`, defaultPath: `${safeName(request.catalog)}.sql`, filters: [{ name: "SQL backup", extensions: ["sql"] }] });
    if (save.canceled || !save.filePath) return { canceled: true };
    return operations.backup(request, save.filePath);
  });

  ipcMain.handle(IPC.restore, async (_event, request: AdministrationRestoreRequest) => {
    const open = await dialog.showOpenDialog({ title: `Restore ${request.catalog}`, properties: ["openFile"], filters: [{ name: "SQL backup", extensions: ["sql"] }] });
    const path = open.filePaths[0];
    if (open.canceled || !path) return { canceled: true };
    return operations.restore(request, path, request.confirmation);
  });
}

function safeName(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "") || "database";
}

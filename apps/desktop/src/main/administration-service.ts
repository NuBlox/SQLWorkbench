import type { ConnectionManager } from "@nublox/workbench-core";
import type {
  DatabaseAccount,
  DatabaseAdministrationPreview,
  DatabaseAdministrationProvider,
  DatabaseBackupHook,
  DatabaseDataTransferRequest,
  DatabaseDataTransferResult,
  DatabaseLockWait,
  DatabasePrivilegeGrant,
  DatabaseRoleMembership,
  DatabaseSecurityChange,
  DatabaseServerSession,
  DatabaseServerStatus,
  DatabaseServerVariable,
  DatabaseSession,
  DatabaseStorageSummary,
  DatabaseTableCompareRequest,
  DatabaseTableCompareResult,
  DatabaseTableData,
} from "@nublox/workbench-provider-api";

export class DesktopAdministrationService {
  constructor(private readonly connections: ConnectionManager) {}

  async listSessions(connectionId: string): Promise<readonly DatabaseServerSession[]> { const { administration, session } = this.#require(connectionId, "sessions"); return administration.listSessions(session); }
  async listLockWaits(connectionId: string): Promise<readonly DatabaseLockWait[]> { const { administration, session } = this.#require(connectionId, "locks"); return requireMethod(administration, administration.listLockWaits, "lock inspection")(session); }
  async listVariables(connectionId: string, filter?: string): Promise<readonly DatabaseServerVariable[]> { const { administration, session } = this.#require(connectionId, "serverVariables"); return administration.listServerVariables(session, normalizeFilter(filter)); }
  async listStatus(connectionId: string, filter?: string): Promise<readonly DatabaseServerStatus[]> { const { administration, session } = this.#require(connectionId, "serverStatus"); return administration.listServerStatus(session, normalizeFilter(filter)); }

  async listAccounts(connectionId: string): Promise<readonly DatabaseAccount[]> { const { administration, session } = this.#require(connectionId, "users"); return requireMethod(administration, administration.listAccounts, "account inspection")(session); }
  async listRoleMemberships(connectionId: string): Promise<readonly DatabaseRoleMembership[]> { const { administration, session } = this.#require(connectionId, "users"); return requireMethod(administration, administration.listRoleMemberships, "role inspection")(session); }
  async listPrivilegeGrants(connectionId: string, grantee?: string): Promise<readonly DatabasePrivilegeGrant[]> { const { administration, session } = this.#require(connectionId, "users"); return requireMethod(administration, administration.listPrivilegeGrants, "privilege inspection")(session, normalizeFilter(grantee)); }

  previewSecurityChange(connectionId: string, change: DatabaseSecurityChange): DatabaseAdministrationPreview {
    const { administration } = this.#require(connectionId, "users");
    return requireMethod(administration, administration.previewSecurityChange, "security change preview")(change);
  }

  async executeSecurityChange(connectionId: string, change: DatabaseSecurityChange, confirmation: string): Promise<DatabaseAdministrationPreview> {
    const { administration, session } = this.#require(connectionId, "users");
    const preview = requireMethod(administration, administration.previewSecurityChange, "security change preview")(change);
    if (confirmation.trim() !== preview.confirmation) throw new Error(`Confirmation must exactly match '${preview.confirmation}'.`);
    await requireMethod(administration, administration.executeSecurityChange, "security change execution")(session, change);
    return preview;
  }

  async listStorage(connectionId: string): Promise<readonly DatabaseStorageSummary[]> { const { administration, session } = this.#require(connectionId, "storage"); return requireMethod(administration, administration.listStorage, "storage inspection")(session); }
  async exportTable(connectionId: string, catalog: string, table: string, limit?: number): Promise<DatabaseTableData> { const { administration, session } = this.#require(connectionId, "importExport"); return requireMethod(administration, administration.exportTable, "table export")(session, requireText(catalog, "Catalog"), requireText(table, "Table"), limit); }
  async importTable(connectionId: string, data: DatabaseTableData, truncateTarget = false): Promise<DatabaseDataTransferResult> { const { administration, session } = this.#require(connectionId, "importExport"); return requireMethod(administration, administration.importTable, "table import")(session, data, truncateTarget); }
  async compareTables(connectionId: string, request: DatabaseTableCompareRequest): Promise<DatabaseTableCompareResult> { const { administration, session } = this.#require(connectionId, "dataTransfer"); return requireMethod(administration, administration.compareTables, "table comparison")(session, request); }
  async transferTable(connectionId: string, request: DatabaseDataTransferRequest, confirmation: string): Promise<DatabaseDataTransferResult> { const { administration, session } = this.#require(connectionId, "dataTransfer"); if (confirmation.trim() !== "TRANSFER DATA") throw new Error("Confirmation must exactly match 'TRANSFER DATA'."); return requireMethod(administration, administration.transferTable, "data transfer")(session, request); }
  listBackupHooks(connectionId: string): readonly DatabaseBackupHook[] { const { administration } = this.#require(connectionId, "backupRestore"); return requireMethod(administration, administration.listBackupHooks, "backup hook discovery")(); }

  #require(connectionId: string, capability: keyof DatabaseAdministrationProvider["capabilities"]): { administration: DatabaseAdministrationProvider; session: DatabaseSession } {
    const normalized = connectionId.trim();
    if (!normalized) throw new Error("Connection id cannot be empty.");
    const { provider, session } = this.connections.get(normalized);
    const administration = provider.administration;
    if (!administration || !administration.capabilities[capability]) throw new Error(`Database provider '${provider.id}' does not support administration capability '${capability}'.`);
    return { administration, session };
  }
}

function requireMethod<T extends (...args: any[]) => any>(provider: DatabaseAdministrationProvider, method: T | undefined, label: string): T {
  if (!method) throw new Error(`Database provider '${provider.providerId}' advertises ${label} but does not implement it.`);
  return method.bind(provider) as T;
}
function normalizeFilter(filter?: string): string | undefined { const value = filter?.trim(); if (!value) return undefined; if (value.length > 200) throw new Error("Administration filter cannot exceed 200 characters."); return value; }
function requireText(value: string, label: string): string { const result = value.trim(); if (!result) throw new Error(`${label} cannot be empty.`); return result; }

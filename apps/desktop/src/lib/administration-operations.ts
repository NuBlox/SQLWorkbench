import type {
  DatabaseAccount,
  DatabaseAdministrationPreview,
  DatabaseBackupHook,
  DatabaseDataTransferRequest,
  DatabaseDataTransferResult,
  DatabasePrivilegeGrant,
  DatabaseRoleMembership,
  DatabaseSecurityChange,
  DatabaseStorageSummary,
  DatabaseTableCompareRequest,
  DatabaseTableCompareResult,
} from "@nublox/workbench-provider-api";

export interface SecurityPreviewRequest {
  readonly connectionId: string;
  readonly change: DatabaseSecurityChange;
}

export interface SecurityExecuteRequest extends SecurityPreviewRequest {
  readonly confirmation: string;
}

export interface TableExportRequest {
  readonly connectionId: string;
  readonly catalog: string;
  readonly table: string;
  readonly limit?: number;
}

export interface TableExportResponse {
  readonly canceled: boolean;
  readonly path?: string;
  readonly rows?: number;
}

export interface TableImportRequest {
  readonly connectionId: string;
  readonly catalog?: string;
  readonly table?: string;
  readonly truncateTarget?: boolean;
}

export interface TableImportResponse {
  readonly canceled: boolean;
  readonly path?: string;
  readonly result?: DatabaseDataTransferResult;
}

export interface CompareRequest extends DatabaseTableCompareRequest {
  readonly connectionId: string;
}

export interface TransferRequest extends DatabaseDataTransferRequest {
  readonly connectionId: string;
  readonly confirmation: string;
}

export interface DesktopAdministrationOperationsApi {
  accounts(connectionId: string): Promise<readonly DatabaseAccount[]>;
  roles(connectionId: string): Promise<readonly DatabaseRoleMembership[]>;
  privileges(connectionId: string, grantee?: string): Promise<readonly DatabasePrivilegeGrant[]>;
  previewSecurity(request: SecurityPreviewRequest): Promise<DatabaseAdministrationPreview>;
  executeSecurity(request: SecurityExecuteRequest): Promise<DatabaseAdministrationPreview>;
  storage(connectionId: string): Promise<readonly DatabaseStorageSummary[]>;
  exportTable(request: TableExportRequest): Promise<TableExportResponse>;
  importTable(request: TableImportRequest): Promise<TableImportResponse>;
  compare(request: CompareRequest): Promise<DatabaseTableCompareResult>;
  transfer(request: TransferRequest): Promise<DatabaseDataTransferResult>;
  backupHooks(connectionId: string): Promise<readonly DatabaseBackupHook[]>;
}

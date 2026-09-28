import type { DatabaseSession } from "./index.js";

export interface DatabaseAdministrationCapabilities {
  readonly sessions: boolean;
  readonly locks: boolean;
  readonly serverVariables: boolean;
  readonly serverStatus: boolean;
  readonly users: boolean;
  readonly storage: boolean;
  readonly importExport: boolean;
  readonly backupRestore: boolean;
  readonly dataTransfer: boolean;
}

export interface DatabaseServerSession {
  readonly id: string;
  readonly user: string;
  readonly host?: string;
  readonly database?: string;
  readonly command: string;
  readonly timeSeconds: number;
  readonly state?: string;
  readonly statement?: string;
}

export interface DatabaseServerVariable { readonly name: string; readonly value: string; }
export interface DatabaseServerStatus { readonly name: string; readonly value: string; }

export interface DatabaseLockWait {
  readonly waitingSessionId: string;
  readonly blockingSessionId?: string;
  readonly object?: string;
  readonly lockType?: string;
  readonly lockMode?: string;
  readonly waitSeconds?: number;
  readonly statement?: string;
}

export interface DatabaseAccount {
  readonly grantee: string;
  readonly user: string;
  readonly host: string;
  readonly kind: "user" | "role";
  readonly accountLocked?: boolean;
  readonly passwordExpired?: boolean;
}

export interface DatabaseRoleMembership {
  readonly grantee: string;
  readonly role: string;
  readonly adminOption: boolean;
  readonly defaultRole?: boolean;
}

export type DatabasePrivilegeScope = "global" | "schema" | "table";
export interface DatabasePrivilegeGrant {
  readonly grantee: string;
  readonly privilege: string;
  readonly scope: DatabasePrivilegeScope;
  readonly catalog?: string;
  readonly table?: string;
  readonly grantable: boolean;
}

interface DatabasePrivilegeSecurityChangeBase {
  readonly grantee: string;
  readonly privilege: string;
  readonly scope: DatabasePrivilegeScope;
  readonly catalog?: string;
  readonly table?: string;
  readonly withGrantOption?: boolean;
}

interface DatabaseRoleSecurityChangeBase {
  readonly grantee: string;
  readonly role: string;
  readonly adminOption?: boolean;
}

export type DatabaseSecurityChange =
  | ({ readonly kind: "grant-privilege" } & DatabasePrivilegeSecurityChangeBase)
  | ({ readonly kind: "revoke-privilege" } & DatabasePrivilegeSecurityChangeBase)
  | ({ readonly kind: "grant-role" } & DatabaseRoleSecurityChangeBase)
  | ({ readonly kind: "revoke-role" } & DatabaseRoleSecurityChangeBase);

export interface DatabaseAdministrationPreview {
  readonly providerId: string;
  readonly statements: readonly string[];
  readonly destructive: boolean;
  readonly confirmation: string;
  readonly warnings: readonly string[];
}

export interface DatabaseStorageSummary {
  readonly catalog: string;
  readonly tables: number;
  readonly estimatedRows: number;
  readonly dataBytes: number;
  readonly indexBytes: number;
  readonly totalBytes: number;
}

export interface DatabaseTableData {
  readonly catalog: string;
  readonly table: string;
  readonly columns: readonly string[];
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

export interface DatabaseDataTransferRequest {
  readonly sourceCatalog: string;
  readonly sourceTable: string;
  readonly targetCatalog: string;
  readonly targetTable: string;
  readonly limit?: number;
  readonly truncateTarget?: boolean;
}

export interface DatabaseDataTransferResult {
  readonly rowsRead: number;
  readonly rowsWritten: number;
  readonly target: string;
}

export interface DatabaseTableCompareRequest {
  readonly leftCatalog: string;
  readonly leftTable: string;
  readonly rightCatalog: string;
  readonly rightTable: string;
}

export interface DatabaseTableCompareResult {
  readonly leftCount: number;
  readonly rightCount: number;
  readonly matchingColumns: readonly string[];
  readonly leftOnlyColumns: readonly string[];
  readonly rightOnlyColumns: readonly string[];
  readonly rowCountDelta: number;
}

export interface DatabaseBackupHook {
  readonly id: string;
  readonly label: string;
  readonly available: boolean;
  readonly description: string;
}

export interface DatabaseAdministrationProvider {
  readonly providerId: string;
  readonly capabilities: DatabaseAdministrationCapabilities;
  listSessions(session: DatabaseSession): Promise<readonly DatabaseServerSession[]>;
  listServerVariables(session: DatabaseSession, filter?: string): Promise<readonly DatabaseServerVariable[]>;
  listServerStatus(session: DatabaseSession, filter?: string): Promise<readonly DatabaseServerStatus[]>;
  listLockWaits?(session: DatabaseSession): Promise<readonly DatabaseLockWait[]>;
  listAccounts?(session: DatabaseSession): Promise<readonly DatabaseAccount[]>;
  listRoleMemberships?(session: DatabaseSession): Promise<readonly DatabaseRoleMembership[]>;
  listPrivilegeGrants?(session: DatabaseSession, grantee?: string): Promise<readonly DatabasePrivilegeGrant[]>;
  previewSecurityChange?(change: DatabaseSecurityChange): DatabaseAdministrationPreview;
  executeSecurityChange?(session: DatabaseSession, change: DatabaseSecurityChange): Promise<void>;
  listStorage?(session: DatabaseSession): Promise<readonly DatabaseStorageSummary[]>;
  exportTable?(session: DatabaseSession, catalog: string, table: string, limit?: number): Promise<DatabaseTableData>;
  importTable?(session: DatabaseSession, data: DatabaseTableData, truncateTarget?: boolean): Promise<DatabaseDataTransferResult>;
  compareTables?(session: DatabaseSession, request: DatabaseTableCompareRequest): Promise<DatabaseTableCompareResult>;
  transferTable?(session: DatabaseSession, request: DatabaseDataTransferRequest): Promise<DatabaseDataTransferResult>;
  listBackupHooks?(): readonly DatabaseBackupHook[];
}

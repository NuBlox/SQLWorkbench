import type { DatabaseSession, QueryResultSet } from "./index.js";

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

export interface DatabaseServerVariable {
  readonly name: string;
  readonly value: string;
}

export interface DatabaseServerStatus {
  readonly name: string;
  readonly value: string;
}

export interface DatabaseLockWait {
  readonly waitingSessionId: string;
  readonly blockingSessionId?: string;
  readonly object?: string;
  readonly lockType?: string;
  readonly lockMode?: string;
  readonly waitSeconds?: number;
  readonly statement?: string;
}

export interface DatabaseSecurityPrincipal {
  readonly grantee: string;
  readonly name: string;
  readonly host?: string;
  readonly kind: "user" | "role" | "unknown";
  readonly accountLocked?: boolean;
  readonly passwordExpired?: boolean;
  readonly authenticationPlugin?: string;
}

export interface DatabaseSecurityPrivilege {
  readonly grantee: string;
  readonly privilege: string;
  readonly scope: "global" | "schema" | "table" | "column";
  readonly catalog?: string;
  readonly table?: string;
  readonly column?: string;
  readonly grantable: boolean;
}

export interface DatabaseRoleMembership {
  readonly grantee: string;
  readonly role: string;
  readonly grantable: boolean;
  readonly defaultRole?: boolean;
}

export type DatabaseSecurityChange =
  | { readonly kind: "create-role"; readonly role: string }
  | { readonly kind: "drop-role"; readonly role: string }
  | { readonly kind: "grant-role"; readonly role: string; readonly grantee: string; readonly adminOption?: boolean }
  | { readonly kind: "revoke-role"; readonly role: string; readonly grantee: string }
  | {
      readonly kind: "grant-privileges";
      readonly grantee: string;
      readonly privileges: readonly string[];
      readonly scope: "global" | "schema" | "table";
      readonly catalog?: string;
      readonly table?: string;
      readonly grantOption?: boolean;
    }
  | {
      readonly kind: "revoke-privileges";
      readonly grantee: string;
      readonly privileges: readonly string[];
      readonly scope: "global" | "schema" | "table";
      readonly catalog?: string;
      readonly table?: string;
    };

export interface DatabaseAdministrationPreview {
  readonly providerId: string;
  readonly statements: readonly string[];
  readonly destructive: boolean;
  readonly warnings: readonly string[];
}

export interface DatabaseStorageEntry {
  readonly catalog: string;
  readonly table?: string;
  readonly engine?: string;
  readonly estimatedRows?: number;
  readonly dataBytes: number;
  readonly indexBytes: number;
  readonly freeBytes: number;
  readonly totalBytes: number;
}

export interface DatabaseTableReference {
  readonly catalog: string;
  readonly table: string;
}

export interface DatabaseTableReadRequest extends DatabaseTableReference {
  readonly limit: number;
}

export interface DatabaseTableWriteRequest extends DatabaseTableReference {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
}

export interface DatabaseDataWriteResult {
  readonly rowsAttempted: number;
  readonly rowsWritten: number;
}

export interface DatabaseExternalConnection {
  readonly host: string;
  readonly port?: number;
  readonly user: string;
  readonly database?: string;
}

export interface DatabaseExternalToolPlan {
  readonly executable: string;
  readonly args: readonly string[];
  readonly direction: "stdout-to-file" | "file-to-stdin";
  readonly passwordEnvironmentVariable?: string;
  readonly destructive: boolean;
  readonly warnings: readonly string[];
}

export interface DatabaseAdministrationProvider {
  readonly providerId: string;
  readonly capabilities: DatabaseAdministrationCapabilities;
  listSessions(session: DatabaseSession): Promise<readonly DatabaseServerSession[]>;
  listServerVariables(session: DatabaseSession, filter?: string): Promise<readonly DatabaseServerVariable[]>;
  listServerStatus(session: DatabaseSession, filter?: string): Promise<readonly DatabaseServerStatus[]>;
  listLockWaits?(session: DatabaseSession): Promise<readonly DatabaseLockWait[]>;
  listSecurityPrincipals?(session: DatabaseSession): Promise<readonly DatabaseSecurityPrincipal[]>;
  listSecurityPrivileges?(session: DatabaseSession, grantee?: string): Promise<readonly DatabaseSecurityPrivilege[]>;
  listRoleMemberships?(session: DatabaseSession): Promise<readonly DatabaseRoleMembership[]>;
  previewSecurityChange?(change: DatabaseSecurityChange): DatabaseAdministrationPreview;
  applySecurityChange?(session: DatabaseSession, change: DatabaseSecurityChange): Promise<void>;
  listStorage?(session: DatabaseSession): Promise<readonly DatabaseStorageEntry[]>;
  readTableRows?(session: DatabaseSession, request: DatabaseTableReadRequest): Promise<QueryResultSet>;
  writeTableRows?(session: DatabaseSession, request: DatabaseTableWriteRequest): Promise<DatabaseDataWriteResult>;
  createBackupPlan?(connection: DatabaseExternalConnection, catalog: string): DatabaseExternalToolPlan;
  createRestorePlan?(connection: DatabaseExternalConnection, catalog: string): DatabaseExternalToolPlan;
}

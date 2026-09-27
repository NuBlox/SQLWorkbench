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

export interface DatabaseAdministrationProvider {
  readonly providerId: string;
  readonly capabilities: DatabaseAdministrationCapabilities;
  listSessions(session: DatabaseSession): Promise<readonly DatabaseServerSession[]>;
  listServerVariables(session: DatabaseSession, filter?: string): Promise<readonly DatabaseServerVariable[]>;
  listServerStatus(session: DatabaseSession, filter?: string): Promise<readonly DatabaseServerStatus[]>;
  listLockWaits?(session: DatabaseSession): Promise<readonly DatabaseLockWait[]>;
}

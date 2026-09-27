import type { WorkbenchCapability } from "./capabilities.js";

export interface DatabaseDialectDescriptor {
  readonly id: string;
  readonly displayName: string;
  readonly aliases?: readonly string[];
}

export interface DatabaseProviderDefinition {
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly dialects: readonly DatabaseDialectDescriptor[];
  /** Capabilities that are implemented and safe for the Workbench to enable. */
  readonly capabilities: readonly WorkbenchCapability[];
  /** Declared roadmap capabilities that must not yet be enabled at runtime. */
  readonly plannedCapabilities?: readonly WorkbenchCapability[];
  readonly documentationUrl?: string;
}

export interface DatabaseConnectionProfile {
  readonly id: string;
  readonly name: string;
  readonly providerId: string;
  readonly host: string;
  readonly port?: number;
  readonly database?: string;
  readonly username?: string;
  readonly sslMode?:
    | "disabled"
    | "preferred"
    | "required"
    | "verify-ca"
    | "verify-identity";
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface QueryRequest {
  readonly sql: string;
  readonly parameters?: readonly unknown[];
  readonly timeoutMs?: number;
  readonly maxRows?: number;
}

export interface ResultColumn {
  readonly name: string;
  readonly dataType?: string;
  readonly nullable?: boolean;
}

export interface QueryResult<Row = Readonly<Record<string, unknown>>> {
  readonly columns: readonly ResultColumn[];
  readonly rows: readonly Row[];
  readonly affectedRows?: number;
  readonly durationMs: number;
  readonly warnings?: readonly string[];
}

export interface DatabaseSession {
  readonly id: string;
  readonly providerId: string;
  readonly profileId: string;
  execute<Row = Readonly<Record<string, unknown>>>(
    request: QueryRequest,
  ): Promise<QueryResult<Row>>;
  close(): Promise<void>;
}

export interface ConnectionRequest {
  readonly profile: DatabaseConnectionProfile;
  readonly password?: string;
}

export interface DatabaseProviderRuntime {
  readonly definition: DatabaseProviderDefinition;
  connect(request: ConnectionRequest): Promise<DatabaseSession>;
}

export type DatabaseProviderFactory = () => DatabaseProviderRuntime;

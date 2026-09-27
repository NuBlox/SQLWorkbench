import type {
  DatabaseCatalog,
  DatabaseNamespaceReference,
  DatabaseNamespaceSummary,
  DatabaseObjectSummary,
  DatabasePrincipal,
  DatabasePrivilege,
  DatabaseSearchResult,
  EventDefinition,
  RoleGrantDefinition,
  RoutineDefinition,
  TableDefinition,
  TriggerDefinition,
} from "@nublox/workbench-catalog";

export interface CancellationSignal {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: "abort", listener: () => void, options?: { readonly once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface DatabaseCapabilities {
  readonly catalogIntrospection: boolean;
  readonly schemas: boolean;
  readonly views: boolean;
  readonly indexes: boolean;
  readonly foreignKeys: boolean;
  readonly procedures: boolean;
  readonly functions: boolean;
  readonly triggers: boolean;
  readonly events?: boolean;
  readonly partitions: boolean;
  readonly transactions: boolean;
  readonly savepoints: boolean;
  readonly explainPlan: boolean;
  readonly queryCancellation: boolean;
  readonly objectSearch?: boolean;
  readonly privilegeIntrospection?: boolean;
  readonly serverAdministration: boolean;
  readonly userAdministration: boolean;
}

export interface DatabaseConnectionConfig {
  readonly providerId: string;
  readonly host: string;
  readonly port?: number;
  readonly user: string;
  readonly password?: string;
  readonly database?: string;
  readonly connectTimeoutMs?: number;
  readonly tls?: DatabaseTlsConfig;
  readonly options?: Readonly<Record<string, unknown>>;
}

export interface DatabaseTlsConfig {
  readonly ca?: string;
  readonly cert?: string;
  readonly key?: string;
  readonly rejectUnauthorized?: boolean;
}

export interface SessionHealth { readonly ok: boolean; readonly latencyMs?: number; readonly message?: string; }
export interface DatabaseSession { readonly id: string; readonly providerId: string; readonly connectedAt: string; health(): Promise<SessionHealth>; close(): Promise<void>; }
export interface QueryRequest { readonly sql: string; readonly values?: readonly unknown[] | Readonly<Record<string, unknown>>; readonly mode?: "text" | "prepared"; readonly timeoutMs?: number; readonly signal?: CancellationSignal; }
export interface QueryColumn { readonly name: string; readonly table?: string; readonly catalog?: string; readonly databaseType?: string; }
export interface QueryResultSet { readonly columns: readonly QueryColumn[]; readonly rows: readonly Readonly<Record<string, unknown>>[]; readonly affectedRows?: number; readonly changedRows?: number; readonly insertId?: number; readonly warningCount?: number; readonly message?: string; }
export interface QueryExecution { readonly startedAt: string; readonly finishedAt: string; readonly elapsedMs: number; readonly resultSets: readonly QueryResultSet[]; }
export interface ExplainPlan { readonly format: string; readonly raw: unknown; }

export type IntrospectionDepth = "namespaces" | "relations" | "full";
export interface IntrospectionOptions { readonly catalogs?: readonly string[]; readonly includeSystem?: boolean; readonly depth?: IntrospectionDepth; }
export interface ExplorerNamespaceOptions { readonly includeSystem?: boolean; }
export interface ExplorerObjectReference extends DatabaseNamespaceReference { readonly name: string; }
export interface ExplorerSearchRequest { readonly term: string; readonly namespace?: DatabaseNamespaceReference; readonly limit?: number; }

export interface DatabaseExplorerProvider {
  listNamespaces(session: DatabaseSession, options?: ExplorerNamespaceOptions): Promise<readonly DatabaseNamespaceSummary[]>;
  listObjects(session: DatabaseSession, namespace: DatabaseNamespaceReference): Promise<readonly DatabaseObjectSummary[]>;
  describeTable(session: DatabaseSession, object: ExplorerObjectReference): Promise<TableDefinition>;
  listRoutines(session: DatabaseSession, namespace: DatabaseNamespaceReference): Promise<readonly RoutineDefinition[]>;
  listTriggers(session: DatabaseSession, namespace: DatabaseNamespaceReference): Promise<readonly TriggerDefinition[]>;
  listEvents(session: DatabaseSession, namespace: DatabaseNamespaceReference): Promise<readonly EventDefinition[]>;
  listPrincipals(session: DatabaseSession): Promise<readonly DatabasePrincipal[]>;
  listRoleGrants(session: DatabaseSession): Promise<readonly RoleGrantDefinition[]>;
  listPrivileges(session: DatabaseSession, grantee?: string): Promise<readonly DatabasePrivilege[]>;
  search(session: DatabaseSession, request: ExplorerSearchRequest): Promise<readonly DatabaseSearchResult[]>;
}

export interface DatabaseProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: DatabaseCapabilities;
  readonly explorer?: DatabaseExplorerProvider;
  connect(config: DatabaseConnectionConfig): Promise<DatabaseSession>;
  introspect(session: DatabaseSession, options?: IntrospectionOptions): Promise<DatabaseCatalog>;
  execute(session: DatabaseSession, request: QueryRequest): Promise<QueryExecution>;
  explain(session: DatabaseSession, request: QueryRequest): Promise<ExplainPlan>;
  quoteIdentifier(identifier: string): string;
}

import type {
  ConnectionCredential,
  ConnectionProfile,
  ConnectionProfileDraft,
} from "@nublox/workbench-connection-profiles";
import type {
  ExplorerEvent,
  ExplorerNamespace,
  ExplorerNamespaceRequest,
  ExplorerPrincipal,
  ExplorerPrivilege,
  ExplorerPrivilegeRequest,
  ExplorerRelation,
  ExplorerRelationDetails,
  ExplorerRelationDetailsRequest,
  ExplorerRelationRequest,
  ExplorerRoleGrant,
  ExplorerRoutine,
  ExplorerSearchRequest,
  ExplorerSearchResult,
  ExplorerTrigger,
} from "@nublox/workbench-core";
import type {
  DatabaseMigrationPreview,
  DatabaseReferentialAction,
  DatabaseSchemaChangePlan,
  DatabaseViewChangePlan,
  DatabaseViewDefinition,
} from "@nublox/workbench-provider-api";
import type { QueryCompletionCatalog } from "@nublox/workbench-query-engineering";
import type {
  DependencyGraph,
  SchemaDraftInput,
  SchemaDraftView,
  SchemaPreview,
} from "@nublox/workbench-schema-engineering";

export type {
  ExplorerEvent,
  ExplorerNamespace,
  ExplorerNamespaceRequest,
  ExplorerPrincipal,
  ExplorerPrivilege,
  ExplorerPrivilegeRequest,
  ExplorerRelation,
  ExplorerRelationDetails,
  ExplorerRelationDetailsRequest,
  ExplorerRelationRequest,
  ExplorerRoleGrant,
  ExplorerRoutine,
  ExplorerSearchRequest,
  ExplorerSearchResult,
  ExplorerTrigger,
} from "@nublox/workbench-core";
export type {
  DatabaseMigrationPreview,
  DatabaseReferentialAction,
  DatabaseSchemaChangePlan,
  DatabaseViewAlgorithm,
  DatabaseViewChangePlan,
  DatabaseViewCheckOption,
  DatabaseViewDefinition,
  DatabaseViewSecurityType,
} from "@nublox/workbench-provider-api";
export type {
  QueryCatalogColumn,
  QueryCatalogNamespace,
  QueryCatalogRelation,
  QueryCompletionCatalog,
} from "@nublox/workbench-query-engineering";
export type {
  DependencyEdge,
  DependencyGraph,
  DependencyNode,
  SchemaAttributeDraft,
  SchemaDraftInput,
  SchemaDraftView,
  SchemaIndexDraft,
  SchemaPreview,
  SchemaRelationshipDraft,
} from "@nublox/workbench-schema-engineering";

export interface SaveProfileRequest {
  readonly draft: ConnectionProfileDraft;
  readonly expectedRevision?: number;
  readonly credential?: ConnectionCredential;
}
export interface DeleteProfileRequest { readonly id: string; readonly expectedRevision: number; }
export interface OpenConnectionInfo {
  readonly id: string;
  readonly profileId: string;
  readonly providerId: string;
  readonly connectedAt: string;
  readonly healthy: boolean;
  readonly latencyMs?: number;
  readonly message?: string;
}

export type QueryRunMode = "statement" | "selection" | "script";
export type QueryCellValue = string | number | boolean | null;
export interface QueryColumnView { readonly name: string; readonly table?: string; readonly catalog?: string; readonly databaseType?: string; }
export interface QueryResultSetView {
  readonly columns: readonly QueryColumnView[];
  readonly rows: readonly Readonly<Record<string, QueryCellValue>>[];
  readonly affectedRows?: number;
  readonly changedRows?: number;
  readonly insertId?: number;
  readonly warningCount?: number;
  readonly message?: string;
}
export interface QueryExecutionView {
  readonly executionId: string;
  readonly connectionId: string;
  readonly mode: QueryRunMode;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly elapsedMs: number;
  readonly statementCount: number;
  readonly resultSets: readonly QueryResultSetView[];
}
export interface ExecuteQueryRequest {
  readonly executionId: string;
  readonly connectionId: string;
  readonly sql: string;
  readonly mode: QueryRunMode;
  readonly timeoutMs?: number;
}
export type QueryHistoryStatus = "success" | "error" | "cancelled";
export interface QueryHistoryEntry {
  readonly id: string;
  readonly connectionId: string;
  readonly mode: QueryRunMode;
  readonly sql: string;
  readonly startedAt: string;
  readonly elapsedMs: number;
  readonly status: QueryHistoryStatus;
  readonly statementCount: number;
  readonly resultSetCount: number;
  readonly message?: string;
}
export type ExportFormat = "csv" | "json";
export interface ExportResultRequest { readonly format: ExportFormat; readonly suggestedName: string; readonly resultSet: QueryResultSetView; }
export interface ExportResultResponse { readonly canceled: boolean; readonly path?: string; }

export interface SchemaLoadRequest extends ExplorerRelationDetailsRequest {}
export interface SchemaPreviewRequest extends ExplorerRelationDetailsRequest {
  readonly draft: SchemaDraftInput;
}
export interface SchemaGraphRequest extends ExplorerRelationRequest {}
export interface SchemaExecutionGuard {
  readonly fingerprint: string;
  readonly destructive: boolean;
  readonly confirmationPhrase: string;
}
export interface SchemaPreparedPreview {
  readonly preview: SchemaPreview;
  readonly guard: SchemaExecutionGuard;
}
export interface SchemaExecuteRequest extends SchemaPreviewRequest {
  readonly fingerprint: string;
  readonly confirmation: string;
}
export interface SchemaExecutionResult {
  readonly completed: boolean;
  readonly executedStatements: number;
  readonly totalStatements: number;
  readonly failedStatementIndex?: number;
  readonly error?: string;
  readonly refreshedDraft?: SchemaDraftView;
}

export interface ViewLoadRequest extends ExplorerRelationDetailsRequest {}
export interface ViewPreviewRequest extends ViewLoadRequest {
  readonly draft: DatabaseViewChangePlan;
}
export interface ViewExecutionGuard {
  readonly fingerprint: string;
  readonly confirmationPhrase: string;
}
export interface ViewPreparedPreview {
  readonly live: DatabaseViewDefinition;
  readonly draft: DatabaseViewChangePlan;
  readonly preview: DatabaseMigrationPreview;
  readonly guard: ViewExecutionGuard;
}
export interface ViewExecuteRequest extends ViewPreviewRequest {
  readonly fingerprint: string;
  readonly confirmation: string;
}
export interface ViewExecutionResult {
  readonly completed: boolean;
  readonly executedStatements: number;
  readonly totalStatements: number;
  readonly failedStatementIndex?: number;
  readonly error?: string;
  readonly refreshedView?: DatabaseViewDefinition;
}

interface ErRelationshipBase extends ExplorerRelationRequest {
  readonly sourceTable: string;
  readonly foreignKey: string;
}
export interface ErAddRelationshipRequest extends ErRelationshipBase {
  readonly operation: "add";
  readonly sourceColumns: readonly string[];
  readonly targetTable: string;
  readonly targetColumns: readonly string[];
  readonly onDelete?: DatabaseReferentialAction;
}
export interface ErDropRelationshipRequest extends ErRelationshipBase {
  readonly operation: "drop";
}
export type ErRelationshipRequest = ErAddRelationshipRequest | ErDropRelationshipRequest;
export interface ErExecutionGuard {
  readonly fingerprint: string;
  readonly destructive: boolean;
  readonly confirmationPhrase: string;
}
export interface ErPreparedPreview {
  readonly plan: DatabaseSchemaChangePlan;
  readonly preview: DatabaseMigrationPreview;
  readonly guard: ErExecutionGuard;
}
export type ErExecuteRequest = ErRelationshipRequest & {
  readonly fingerprint: string;
  readonly confirmation: string;
};
export interface ErExecutionResult {
  readonly completed: boolean;
  readonly executedStatements: number;
  readonly totalStatements: number;
  readonly failedStatementIndex?: number;
  readonly error?: string;
}

export interface DesktopApi {
  readonly profiles: {
    list(): Promise<readonly ConnectionProfile[]>;
    save(request: SaveProfileRequest): Promise<ConnectionProfile>;
    remove(request: DeleteProfileRequest): Promise<void>;
    clearCredential(profileId: string): Promise<ConnectionProfile>;
  };
  readonly connections: {
    list(): Promise<readonly OpenConnectionInfo[]>;
    connect(profileId: string): Promise<OpenConnectionInfo>;
    disconnect(profileId: string): Promise<void>;
  };
  readonly explorer: {
    namespaces(request: ExplorerNamespaceRequest): Promise<readonly ExplorerNamespace[]>;
    relations(request: ExplorerRelationRequest): Promise<readonly ExplorerRelation[]>;
    describe(request: ExplorerRelationDetailsRequest): Promise<ExplorerRelationDetails>;
    routines(request: ExplorerRelationRequest): Promise<readonly ExplorerRoutine[]>;
    triggers(request: ExplorerRelationRequest): Promise<readonly ExplorerTrigger[]>;
    events(request: ExplorerRelationRequest): Promise<readonly ExplorerEvent[]>;
    principals(connectionId: string): Promise<readonly ExplorerPrincipal[]>;
    roles(connectionId: string): Promise<readonly ExplorerRoleGrant[]>;
    privileges(request: ExplorerPrivilegeRequest): Promise<readonly ExplorerPrivilege[]>;
    search(request: ExplorerSearchRequest): Promise<readonly ExplorerSearchResult[]>;
  };
  readonly queryLanguage: {
    catalog(connectionId: string): Promise<QueryCompletionCatalog>;
  };
  readonly schema: {
    load(request: SchemaLoadRequest): Promise<SchemaDraftView>;
    preview(request: SchemaPreviewRequest): Promise<SchemaPreparedPreview>;
    graph(request: SchemaGraphRequest): Promise<DependencyGraph>;
    execute(request: SchemaExecuteRequest): Promise<SchemaExecutionResult>;
  };
  readonly views: {
    load(request: ViewLoadRequest): Promise<DatabaseViewDefinition>;
    preview(request: ViewPreviewRequest): Promise<ViewPreparedPreview>;
    execute(request: ViewExecuteRequest): Promise<ViewExecutionResult>;
  };
  readonly er: {
    preview(request: ErRelationshipRequest): Promise<ErPreparedPreview>;
    execute(request: ErExecuteRequest): Promise<ErExecutionResult>;
  };
  readonly queries: {
    execute(request: ExecuteQueryRequest): Promise<QueryExecutionView>;
    cancel(executionId: string): Promise<boolean>;
  };
  readonly history: {
    list(limit?: number): Promise<readonly QueryHistoryEntry[]>;
    clear(): Promise<void>;
  };
  readonly results: { export(request: ExportResultRequest): Promise<ExportResultResponse>; };
  readonly app: { version(): Promise<string>; };
}

import type {
  ConnectionCredential,
  ConnectionProfile,
  ConnectionProfileDraft,
} from "@nublox/workbench-connection-profiles";
import type {
  ExplorerEvent, ExplorerNamespace, ExplorerNamespaceRequest, ExplorerPrincipal, ExplorerPrivilege,
  ExplorerPrivilegeRequest, ExplorerRelation, ExplorerRelationDetails, ExplorerRelationDetailsRequest,
  ExplorerRelationRequest, ExplorerRoleGrant, ExplorerRoutine, ExplorerSearchRequest, ExplorerSearchResult, ExplorerTrigger,
} from "@nublox/workbench-core";
import type {
  DatabaseAdministrationPreview, DatabaseDataWriteResult, DatabaseLockWait, DatabaseMigrationPreview, DatabaseReferentialAction,
  DatabaseRoleMembership, DatabaseSchemaChangePlan, DatabaseSecurityChange, DatabaseSecurityPrincipal, DatabaseSecurityPrivilege,
  DatabaseServerSession, DatabaseServerStatus, DatabaseServerVariable, DatabaseStorageEntry, DatabaseViewChangePlan, DatabaseViewDefinition,
} from "@nublox/workbench-provider-api";
import type { QueryCompletionCatalog } from "@nublox/workbench-query-engineering";
import type { QueryPlanView } from "@nublox/workbench-query-engineering/explain-plan";
import type { DependencyGraph, SchemaDraftInput, SchemaDraftView, SchemaPreview } from "@nublox/workbench-schema-engineering";

export type {
  ExplorerEvent, ExplorerNamespace, ExplorerNamespaceRequest, ExplorerPrincipal, ExplorerPrivilege, ExplorerPrivilegeRequest,
  ExplorerRelation, ExplorerRelationDetails, ExplorerRelationDetailsRequest, ExplorerRelationRequest, ExplorerRoleGrant,
  ExplorerRoutine, ExplorerSearchRequest, ExplorerSearchResult, ExplorerTrigger,
} from "@nublox/workbench-core";
export type {
  DatabaseAdministrationPreview, DatabaseDataWriteResult, DatabaseLockWait, DatabaseMigrationPreview, DatabaseReferentialAction,
  DatabaseRoleMembership, DatabaseSchemaChangePlan, DatabaseSecurityChange, DatabaseSecurityPrincipal, DatabaseSecurityPrivilege,
  DatabaseServerSession, DatabaseServerStatus, DatabaseServerVariable, DatabaseStorageEntry, DatabaseViewAlgorithm,
  DatabaseViewChangePlan, DatabaseViewCheckOption, DatabaseViewDefinition, DatabaseViewSecurityType,
} from "@nublox/workbench-provider-api";
export type { QueryCatalogColumn, QueryCatalogNamespace, QueryCatalogRelation, QueryCompletionCatalog } from "@nublox/workbench-query-engineering";
export type { QueryPlanNode, QueryPlanProperty, QueryPlanView } from "@nublox/workbench-query-engineering/explain-plan";
export type {
  DependencyEdge, DependencyGraph, DependencyNode, SchemaAttributeDraft, SchemaDraftInput, SchemaDraftView,
  SchemaIndexDraft, SchemaPreview, SchemaRelationshipDraft,
} from "@nublox/workbench-schema-engineering";

export interface SaveProfileRequest { readonly draft: ConnectionProfileDraft; readonly expectedRevision?: number; readonly credential?: ConnectionCredential; }
export interface DeleteProfileRequest { readonly id: string; readonly expectedRevision: number; }
export interface OpenConnectionInfo { readonly id: string; readonly profileId: string; readonly providerId: string; readonly connectedAt: string; readonly healthy: boolean; readonly latencyMs?: number; readonly message?: string; }
export interface AdministrationValueRequest { readonly connectionId: string; readonly filter?: string; }
export interface AdministrationSecurityChangeRequest { readonly connectionId: string; readonly change: DatabaseSecurityChange; }
export interface AdministrationGuard { readonly fingerprint: string; readonly destructive: boolean; readonly confirmationPhrase: string; }
export interface AdministrationSecurityPreparedPreview { readonly preview: DatabaseAdministrationPreview; readonly guard: AdministrationGuard; }
export interface AdministrationSecurityExecuteRequest extends AdministrationSecurityChangeRequest { readonly fingerprint: string; readonly confirmation: string; }
export interface AdministrationSecurityExecutionResult { readonly completed: boolean; readonly statementsExecuted: number; }
export interface AdministrationTableRequest { readonly connectionId: string; readonly catalog: string; readonly table: string; readonly limit?: number; }
export interface AdministrationDataFileRequest extends AdministrationTableRequest { readonly format?: "json" | "csv"; }
export interface AdministrationDataFileResult { readonly canceled: boolean; readonly path?: string; readonly rowsRead: number; readonly rowsWritten?: number; }
export interface AdministrationCompareRequest {
  readonly leftConnectionId: string; readonly leftCatalog: string; readonly leftTable: string;
  readonly rightConnectionId: string; readonly rightCatalog: string; readonly rightTable: string; readonly limit?: number;
}
export interface AdministrationCompareResult {
  readonly leftRows: number; readonly rightRows: number; readonly matchingRows: number; readonly differentRows: number;
  readonly onlyLeft: number; readonly onlyRight: number; readonly leftColumns: readonly string[]; readonly rightColumns: readonly string[]; readonly columnsMatch: boolean;
}
export interface AdministrationTransferPreviewRequest extends AdministrationCompareRequest {}
export interface AdministrationTransferPreparedPreview { readonly sourceRows: number; readonly targetRows: number; readonly guard: AdministrationGuard; }
export interface AdministrationTransferExecuteRequest extends AdministrationTransferPreviewRequest { readonly fingerprint: string; readonly confirmation: string; }
export interface AdministrationTransferResult extends DatabaseDataWriteResult { readonly sourceRows: number; }
export interface AdministrationBackupRequest { readonly connectionId: string; readonly catalog: string; }
export interface AdministrationRestoreRequest extends AdministrationBackupRequest { readonly confirmation: string; }
export interface AdministrationExternalToolResult { readonly canceled: boolean; readonly path?: string; readonly executable?: string; readonly exitCode?: number; readonly stderr?: string; }

export type QueryRunMode = "statement" | "selection" | "script";
export type QueryCellValue = string | number | boolean | null;
export interface QueryColumnView { readonly name: string; readonly table?: string; readonly catalog?: string; readonly databaseType?: string; }
export interface QueryResultSetView { readonly columns: readonly QueryColumnView[]; readonly rows: readonly Readonly<Record<string, QueryCellValue>>[]; readonly affectedRows?: number; readonly changedRows?: number; readonly insertId?: number; readonly warningCount?: number; readonly message?: string; }
export interface QueryExecutionView { readonly executionId: string; readonly connectionId: string; readonly mode: QueryRunMode; readonly startedAt: string; readonly finishedAt: string; readonly elapsedMs: number; readonly statementCount: number; readonly resultSets: readonly QueryResultSetView[]; }
export interface ExecuteQueryRequest { readonly executionId: string; readonly connectionId: string; readonly sql: string; readonly mode: QueryRunMode; readonly timeoutMs?: number; }
export interface ExplainQueryRequest { readonly connectionId: string; readonly sql: string; readonly timeoutMs?: number; }
export type QueryHistoryStatus = "success" | "error" | "cancelled";
export interface QueryHistoryEntry { readonly id: string; readonly connectionId: string; readonly mode: QueryRunMode; readonly sql: string; readonly startedAt: string; readonly elapsedMs: number; readonly status: QueryHistoryStatus; readonly statementCount: number; readonly resultSetCount: number; readonly message?: string; }
export interface QueryPlanHistoryEntry { readonly id: string; readonly connectionId: string; readonly sql: string; readonly sqlFingerprint: string; readonly capturedAt: string; readonly explainElapsedMs: number; readonly plan: QueryPlanView; }
export interface QueryPlanHistoryListRequest { readonly connectionId?: string; readonly sqlFingerprint?: string; readonly limit?: number; }
export interface QueryStatisticsRequest { readonly connectionId: string; readonly sql: string; }
export interface QueryStatisticsView {
  readonly connectionId: string; readonly sqlFingerprint: string; readonly executionCount: number; readonly successCount: number; readonly errorCount: number; readonly cancelledCount: number;
  readonly averageElapsedMs?: number; readonly minimumElapsedMs?: number; readonly maximumElapsedMs?: number; readonly lastExecutedAt?: string;
  readonly explainCount: number; readonly lastExplainedAt?: string; readonly latestExplainElapsedMs?: number; readonly latestPlanNodeCount?: number;
  readonly latestPlanCost?: number; readonly previousPlanCost?: number; readonly planCostDelta?: number;
}
export interface QueryPlanAnalysisView extends QueryPlanView { readonly historyEntryId: string; readonly capturedAt: string; readonly explainElapsedMs: number; readonly statistics: QueryStatisticsView; }
export type ExportFormat = "csv" | "json";
export interface ExportResultRequest { readonly format: ExportFormat; readonly suggestedName: string; readonly resultSet: QueryResultSetView; }
export interface ExportResultResponse { readonly canceled: boolean; readonly path?: string; }

export interface SchemaLoadRequest extends ExplorerRelationDetailsRequest {}
export interface SchemaPreviewRequest extends ExplorerRelationDetailsRequest { readonly draft: SchemaDraftInput; }
export interface SchemaGraphRequest extends ExplorerRelationRequest {}
export interface SchemaExecutionGuard { readonly fingerprint: string; readonly destructive: boolean; readonly confirmationPhrase: string; }
export interface SchemaPreparedPreview { readonly preview: SchemaPreview; readonly guard: SchemaExecutionGuard; }
export interface SchemaExecuteRequest extends SchemaPreviewRequest { readonly fingerprint: string; readonly confirmation: string; }
export interface SchemaExecutionResult { readonly completed: boolean; readonly executedStatements: number; readonly totalStatements: number; readonly failedStatementIndex?: number; readonly error?: string; readonly refreshedDraft?: SchemaDraftView; }
export interface ViewLoadRequest extends ExplorerRelationDetailsRequest {}
export interface ViewPreviewRequest extends ViewLoadRequest { readonly draft: DatabaseViewChangePlan; }
export interface ViewExecutionGuard { readonly fingerprint: string; readonly confirmationPhrase: string; }
export interface ViewPreparedPreview { readonly live: DatabaseViewDefinition; readonly draft: DatabaseViewChangePlan; readonly preview: DatabaseMigrationPreview; readonly guard: ViewExecutionGuard; }
export interface ViewExecuteRequest extends ViewPreviewRequest { readonly fingerprint: string; readonly confirmation: string; }
export interface ViewExecutionResult { readonly completed: boolean; readonly executedStatements: number; readonly totalStatements: number; readonly failedStatementIndex?: number; readonly error?: string; readonly refreshedView?: DatabaseViewDefinition; }
interface ErRelationshipBase extends ExplorerRelationRequest { readonly sourceTable: string; readonly foreignKey: string; }
export interface ErAddRelationshipRequest extends ErRelationshipBase { readonly operation: "add"; readonly sourceColumns: readonly string[]; readonly targetTable: string; readonly targetColumns: readonly string[]; readonly onDelete?: DatabaseReferentialAction; }
export interface ErDropRelationshipRequest extends ErRelationshipBase { readonly operation: "drop"; }
export type ErRelationshipRequest = ErAddRelationshipRequest | ErDropRelationshipRequest;
export interface ErExecutionGuard { readonly fingerprint: string; readonly destructive: boolean; readonly confirmationPhrase: string; }
export interface ErPreparedPreview { readonly plan: DatabaseSchemaChangePlan; readonly preview: DatabaseMigrationPreview; readonly guard: ErExecutionGuard; }
export type ErExecuteRequest = ErRelationshipRequest & { readonly fingerprint: string; readonly confirmation: string; };
export interface ErExecutionResult { readonly completed: boolean; readonly executedStatements: number; readonly totalStatements: number; readonly failedStatementIndex?: number; readonly error?: string; }

export interface DesktopApi {
  readonly profiles: { list(): Promise<readonly ConnectionProfile[]>; save(request: SaveProfileRequest): Promise<ConnectionProfile>; remove(request: DeleteProfileRequest): Promise<void>; clearCredential(profileId: string): Promise<ConnectionProfile>; };
  readonly connections: { list(): Promise<readonly OpenConnectionInfo[]>; connect(profileId: string): Promise<OpenConnectionInfo>; disconnect(profileId: string): Promise<void>; };
  readonly administration: {
    sessions(connectionId: string): Promise<readonly DatabaseServerSession[]>;
    locks(connectionId: string): Promise<readonly DatabaseLockWait[]>;
    variables(request: AdministrationValueRequest): Promise<readonly DatabaseServerVariable[]>;
    status(request: AdministrationValueRequest): Promise<readonly DatabaseServerStatus[]>;
    principals(connectionId: string): Promise<readonly DatabaseSecurityPrincipal[]>;
    privileges(connectionId: string, grantee?: string): Promise<readonly DatabaseSecurityPrivilege[]>;
    roles(connectionId: string): Promise<readonly DatabaseRoleMembership[]>;
    previewSecurity(request: AdministrationSecurityChangeRequest): Promise<AdministrationSecurityPreparedPreview>;
    executeSecurity(request: AdministrationSecurityExecuteRequest): Promise<AdministrationSecurityExecutionResult>;
    storage(connectionId: string): Promise<readonly DatabaseStorageEntry[]>;
    exportData(request: AdministrationDataFileRequest): Promise<AdministrationDataFileResult>;
    importData(request: AdministrationTableRequest): Promise<AdministrationDataFileResult>;
    compareData(request: AdministrationCompareRequest): Promise<AdministrationCompareResult>;
    previewTransfer(request: AdministrationTransferPreviewRequest): Promise<AdministrationTransferPreparedPreview>;
    executeTransfer(request: AdministrationTransferExecuteRequest): Promise<AdministrationTransferResult>;
    backup(request: AdministrationBackupRequest): Promise<AdministrationExternalToolResult>;
    restore(request: AdministrationRestoreRequest): Promise<AdministrationExternalToolResult>;
  };
  readonly explorer: {
    namespaces(request: ExplorerNamespaceRequest): Promise<readonly ExplorerNamespace[]>; relations(request: ExplorerRelationRequest): Promise<readonly ExplorerRelation[]>; describe(request: ExplorerRelationDetailsRequest): Promise<ExplorerRelationDetails>;
    routines(request: ExplorerRelationRequest): Promise<readonly ExplorerRoutine[]>; triggers(request: ExplorerRelationRequest): Promise<readonly ExplorerTrigger[]>; events(request: ExplorerRelationRequest): Promise<readonly ExplorerEvent[]>;
    principals(connectionId: string): Promise<readonly ExplorerPrincipal[]>; roles(connectionId: string): Promise<readonly ExplorerRoleGrant[]>; privileges(request: ExplorerPrivilegeRequest): Promise<readonly ExplorerPrivilege[]>; search(request: ExplorerSearchRequest): Promise<readonly ExplorerSearchResult[]>;
  };
  readonly queryLanguage: { catalog(connectionId: string): Promise<QueryCompletionCatalog>; };
  readonly schema: { load(request: SchemaLoadRequest): Promise<SchemaDraftView>; preview(request: SchemaPreviewRequest): Promise<SchemaPreparedPreview>; graph(request: SchemaGraphRequest): Promise<DependencyGraph>; execute(request: SchemaExecuteRequest): Promise<SchemaExecutionResult>; };
  readonly views: { load(request: ViewLoadRequest): Promise<DatabaseViewDefinition>; preview(request: ViewPreviewRequest): Promise<ViewPreparedPreview>; execute(request: ViewExecuteRequest): Promise<ViewExecutionResult>; };
  readonly er: { preview(request: ErRelationshipRequest): Promise<ErPreparedPreview>; execute(request: ErExecuteRequest): Promise<ErExecutionResult>; };
  readonly queries: { execute(request: ExecuteQueryRequest): Promise<QueryExecutionView>; explain(request: ExplainQueryRequest): Promise<QueryPlanAnalysisView>; cancel(executionId: string): Promise<boolean>; };
  readonly history: { list(limit?: number): Promise<readonly QueryHistoryEntry[]>; clear(): Promise<void>; };
  readonly planHistory: { list(request?: QueryPlanHistoryListRequest): Promise<readonly QueryPlanHistoryEntry[]>; clear(): Promise<void>; };
  readonly statistics: { forQuery(request: QueryStatisticsRequest): Promise<QueryStatisticsView>; };
  readonly results: { export(request: ExportResultRequest): Promise<ExportResultResponse>; };
  readonly app: { version(): Promise<string>; rendererReady(): void; };
}

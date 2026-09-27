import type {
  ConnectionCredential,
  ConnectionProfile,
  ConnectionProfileDraft,
} from "@nublox/workbench-connection-profiles";

export interface SaveProfileRequest {
  readonly draft: ConnectionProfileDraft;
  readonly expectedRevision?: number;
  readonly credential?: ConnectionCredential;
}

export interface DeleteProfileRequest {
  readonly id: string;
  readonly expectedRevision: number;
}

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

export interface QueryColumnView {
  readonly name: string;
  readonly table?: string;
  readonly catalog?: string;
  readonly databaseType?: string;
}

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

export interface ExportResultRequest {
  readonly format: ExportFormat;
  readonly suggestedName: string;
  readonly resultSet: QueryResultSetView;
}

export interface ExportResultResponse {
  readonly canceled: boolean;
  readonly path?: string;
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
  readonly queries: {
    execute(request: ExecuteQueryRequest): Promise<QueryExecutionView>;
    cancel(executionId: string): Promise<boolean>;
  };
  readonly history: {
    list(limit?: number): Promise<readonly QueryHistoryEntry[]>;
    clear(): Promise<void>;
  };
  readonly results: {
    export(request: ExportResultRequest): Promise<ExportResultResponse>;
  };
  readonly app: {
    version(): Promise<string>;
  };
}

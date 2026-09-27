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
  readonly app: {
    version(): Promise<string>;
  };
}

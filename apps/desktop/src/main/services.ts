import type {
  ConnectionCredential,
  ConnectionProfile,
  ConnectionProfileDraft,
  ConnectionProfileRepository,
  CredentialStore,
} from "@nublox/workbench-connection-profiles";
import { ConnectionProfileResolver } from "@nublox/workbench-connection-profiles";
import type { WorkbenchConnection } from "@nublox/workbench-core";
import { ConnectionManager } from "@nublox/workbench-core";

import type {
  DeleteProfileRequest,
  OpenConnectionInfo,
  SaveProfileRequest,
} from "../lib/desktop-api.js";

export class DesktopServices {
  readonly #resolver: ConnectionProfileResolver;

  constructor(
    readonly profiles: ConnectionProfileRepository,
    readonly credentials: CredentialStore,
    readonly connections: ConnectionManager,
  ) {
    this.#resolver = new ConnectionProfileResolver(profiles, credentials);
  }

  listProfiles(): Promise<readonly ConnectionProfile[]> {
    return this.profiles.list();
  }

  async saveProfile(request: SaveProfileRequest): Promise<ConnectionProfile> {
    const existing = await this.profiles.get(request.draft.id);
    const credentialProvided = request.credential !== undefined;
    const credentialId = credentialProvided
      ? credentialIdForProfile(request.draft.id)
      : existing?.credentialId;
    const nextDraft = withCredentialId(request.draft, credentialId);

    if (!credentialProvided) {
      return request.expectedRevision === undefined
        ? this.profiles.create(nextDraft)
        : this.profiles.update(nextDraft, request.expectedRevision);
    }

    const previousCredentialId = existing?.credentialId;
    const previousCredential = previousCredentialId
      ? await this.credentials.get(previousCredentialId)
      : undefined;

    await this.credentials.set(credentialId!, request.credential!);
    try {
      const profile = request.expectedRevision === undefined
        ? await this.profiles.create(nextDraft)
        : await this.profiles.update(nextDraft, request.expectedRevision);

      if (previousCredentialId && previousCredentialId !== credentialId) {
        await this.credentials.delete(previousCredentialId);
      }
      return profile;
    } catch (error) {
      await this.#restoreCredential(
        credentialId!,
        previousCredentialId,
        previousCredential,
      );
      throw error;
    }
  }

  async removeProfile(request: DeleteProfileRequest): Promise<void> {
    const profile = await this.profiles.get(request.id);
    const credentialId = profile?.credentialId;
    const previousCredential = credentialId
      ? await this.credentials.get(credentialId)
      : undefined;

    if (credentialId) await this.credentials.delete(credentialId);
    try {
      await this.profiles.delete(request.id, request.expectedRevision);
    } catch (error) {
      if (credentialId && previousCredential) {
        await this.credentials.set(credentialId, previousCredential);
      }
      throw error;
    }

    await this.disconnectProfile(request.id);
  }

  async clearCredential(profileId: string): Promise<ConnectionProfile> {
    const profile = await this.profiles.get(profileId);
    if (!profile) throw new Error(`Connection profile '${profileId}' does not exist.`);
    if (!profile.credentialId) return profile;

    const previousCredential = await this.credentials.get(profile.credentialId);
    await this.credentials.delete(profile.credentialId);
    try {
      return await this.profiles.update(withCredentialId(profile, undefined), profile.revision);
    } catch (error) {
      if (previousCredential) {
        await this.credentials.set(profile.credentialId, previousCredential);
      }
      throw error;
    }
  }

  async listConnections(): Promise<readonly OpenConnectionInfo[]> {
    return Promise.all(this.connections.list().map((connection) => toConnectionInfo(connection)));
  }

  async connectProfile(profileId: string): Promise<OpenConnectionInfo> {
    const current = this.connections.list().find((connection) => connection.id === profileId);
    if (current) return toConnectionInfo(current);

    const config = await this.#resolver.resolve(profileId);
    const connection = await this.connections.connect(profileId, config);
    return toConnectionInfo(connection);
  }

  async disconnectProfile(profileId: string): Promise<void> {
    if (!this.connections.list().some((connection) => connection.id === profileId)) return;
    await this.connections.disconnect(profileId);
  }

  async #restoreCredential(
    newCredentialId: string,
    previousCredentialId: string | undefined,
    previousCredential: ConnectionCredential | undefined,
  ): Promise<void> {
    if (previousCredentialId === newCredentialId && previousCredential) {
      await this.credentials.set(previousCredentialId, previousCredential);
      return;
    }

    await this.credentials.delete(newCredentialId);
    if (previousCredentialId && previousCredential) {
      await this.credentials.set(previousCredentialId, previousCredential);
    }
  }
}

function credentialIdForProfile(profileId: string): string {
  const id = profileId.trim();
  if (!id) throw new Error("Connection profile id cannot be empty.");
  return `connection:${id}`;
}

function withCredentialId(
  source: ConnectionProfileDraft | ConnectionProfile,
  credentialId: string | undefined,
): ConnectionProfileDraft {
  return {
    id: source.id,
    name: source.name,
    providerId: source.providerId,
    host: source.host,
    user: source.user,
    ...(source.port !== undefined ? { port: source.port } : {}),
    ...(source.database !== undefined ? { database: source.database } : {}),
    ...(source.connectTimeoutMs !== undefined
      ? { connectTimeoutMs: source.connectTimeoutMs }
      : {}),
    ...(source.tls !== undefined ? { tls: source.tls } : {}),
    ...(source.options !== undefined ? { options: source.options } : {}),
    ...(credentialId !== undefined ? { credentialId } : {}),
  };
}

async function toConnectionInfo(connection: WorkbenchConnection): Promise<OpenConnectionInfo> {
  const health = await connection.session.health();
  return {
    id: connection.id,
    profileId: connection.id,
    providerId: connection.provider.id,
    connectedAt: connection.session.connectedAt,
    healthy: health.ok,
    ...(health.latencyMs !== undefined ? { latencyMs: health.latencyMs } : {}),
    ...(health.message !== undefined ? { message: health.message } : {}),
  };
}

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  DatabaseConnectionConfig,
  DatabaseTlsConfig,
} from "@nublox/workbench-provider-api";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface ConnectionProfileTls {
  readonly ca?: string;
  readonly cert?: string;
  readonly rejectUnauthorized?: boolean;
}

export interface ConnectionProfileDraft {
  readonly id: string;
  readonly name: string;
  readonly providerId: string;
  readonly host: string;
  readonly port?: number;
  readonly user: string;
  readonly database?: string;
  readonly connectTimeoutMs?: number;
  readonly tls?: ConnectionProfileTls;
  readonly options?: Readonly<Record<string, JsonValue>>;
  readonly credentialId?: string;
}

export interface ConnectionProfile extends ConnectionProfileDraft {
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ConnectionCredential {
  readonly password?: string;
  readonly tlsPrivateKey?: string;
}

export interface ConnectionProfileRepository {
  list(): Promise<readonly ConnectionProfile[]>;
  get(id: string): Promise<ConnectionProfile | undefined>;
  create(draft: ConnectionProfileDraft): Promise<ConnectionProfile>;
  update(draft: ConnectionProfileDraft, expectedRevision: number): Promise<ConnectionProfile>;
  delete(id: string, expectedRevision?: number): Promise<void>;
}

export interface CredentialStore {
  get(id: string): Promise<ConnectionCredential | undefined>;
  set(id: string, credential: ConnectionCredential): Promise<void>;
  delete(id: string): Promise<void>;
}

interface ProfileSnapshot {
  readonly version: 1;
  readonly profiles: readonly ConnectionProfile[];
}

type Clock = () => string;

/**
 * Durable JSON-backed profile repository.
 *
 * This store is intentionally for non-secret connection metadata only. Passwords
 * and TLS private keys belong in a CredentialStore implementation backed by an
 * operating-system secret store.
 */
export class JsonConnectionProfileRepository implements ConnectionProfileRepository {
  readonly #filePath: string;
  readonly #clock: Clock;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(filePath: string, clock: Clock = () => new Date().toISOString()) {
    this.#filePath = requireNonEmptyString(filePath, "Profile file path");
    this.#clock = clock;
  }

  async list(): Promise<readonly ConnectionProfile[]> {
    await this.#mutationTail;
    return this.#readProfiles();
  }

  async get(id: string): Promise<ConnectionProfile | undefined> {
    const profileId = normalizeProfileId(id);
    const profiles = await this.list();
    return profiles.find((profile) => profile.id === profileId);
  }

  create(draft: ConnectionProfileDraft): Promise<ConnectionProfile> {
    return this.#enqueueMutation(async () => {
      const nextDraft = normalizeConnectionProfileDraft(draft);
      const profiles = await this.#readProfiles();
      if (profiles.some((profile) => profile.id === nextDraft.id)) {
        throw new Error(`Connection profile '${nextDraft.id}' already exists.`);
      }

      const now = this.#clock();
      const profile: ConnectionProfile = {
        ...nextDraft,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };

      await this.#writeProfiles([...profiles, profile]);
      return profile;
    });
  }

  update(draft: ConnectionProfileDraft, expectedRevision: number): Promise<ConnectionProfile> {
    assertPositiveInteger(expectedRevision, "Expected profile revision");

    return this.#enqueueMutation(async () => {
      const nextDraft = normalizeConnectionProfileDraft(draft);
      const profiles = await this.#readProfiles();
      const index = profiles.findIndex((profile) => profile.id === nextDraft.id);
      if (index < 0) {
        throw new Error(`Connection profile '${nextDraft.id}' does not exist.`);
      }

      const current = profiles[index]!;
      if (current.revision !== expectedRevision) {
        throw new Error(
          `Connection profile '${nextDraft.id}' revision conflict: expected ${expectedRevision}, current ${current.revision}.`,
        );
      }

      const profile: ConnectionProfile = {
        ...nextDraft,
        revision: current.revision + 1,
        createdAt: current.createdAt,
        updatedAt: this.#clock(),
      };
      const nextProfiles = [...profiles];
      nextProfiles[index] = profile;
      await this.#writeProfiles(nextProfiles);
      return profile;
    });
  }

  delete(id: string, expectedRevision?: number): Promise<void> {
    if (expectedRevision !== undefined) {
      assertPositiveInteger(expectedRevision, "Expected profile revision");
    }

    return this.#enqueueMutation(async () => {
      const profileId = normalizeProfileId(id);
      const profiles = await this.#readProfiles();
      const current = profiles.find((profile) => profile.id === profileId);
      if (!current) {
        return;
      }
      if (expectedRevision !== undefined && current.revision !== expectedRevision) {
        throw new Error(
          `Connection profile '${profileId}' revision conflict: expected ${expectedRevision}, current ${current.revision}.`,
        );
      }

      await this.#writeProfiles(profiles.filter((profile) => profile.id !== profileId));
    });
  }

  async #readProfiles(): Promise<ConnectionProfile[]> {
    let content: string;
    try {
      content = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return [];
      }
      throw error;
    }

    let value: unknown;
    try {
      value = JSON.parse(content) as unknown;
    } catch (error) {
      throw new Error(`Connection profile file '${this.#filePath}' contains invalid JSON.`, {
        cause: error,
      });
    }

    if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.profiles)) {
      throw new Error(`Connection profile file '${this.#filePath}' has an unsupported format.`);
    }

    return value.profiles.map((profile, index) => parseStoredProfile(profile, index));
  }

  async #writeProfiles(profiles: readonly ConnectionProfile[]): Promise<void> {
    const directory = dirname(this.#filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });

    const snapshot: ProfileSnapshot = { version: 1, profiles };
    const tempPath = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      });
      await rename(tempPath, this.#filePath);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  async #enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#mutationTail;
    let release: () => void = () => undefined;
    this.#mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

/**
 * In-memory credential store for tests and ephemeral development only.
 * Production desktop code must provide an OS-backed secure implementation.
 */
export class MemoryCredentialStore implements CredentialStore {
  readonly #credentials = new Map<string, ConnectionCredential>();

  async get(id: string): Promise<ConnectionCredential | undefined> {
    const credential = this.#credentials.get(normalizeCredentialId(id));
    return credential ? { ...credential } : undefined;
  }

  async set(id: string, credential: ConnectionCredential): Promise<void> {
    this.#credentials.set(normalizeCredentialId(id), normalizeCredential(credential));
  }

  async delete(id: string): Promise<void> {
    this.#credentials.delete(normalizeCredentialId(id));
  }
}

export class ConnectionProfileResolver {
  constructor(
    readonly profiles: ConnectionProfileRepository,
    readonly credentials: CredentialStore,
  ) {}

  async resolve(profileId: string): Promise<DatabaseConnectionConfig> {
    const profile = await this.profiles.get(profileId);
    if (!profile) {
      throw new Error(`Connection profile '${profileId}' does not exist.`);
    }

    const credential = profile.credentialId
      ? await this.credentials.get(profile.credentialId)
      : undefined;
    const tls = createTlsConfig(profile.tls, credential?.tlsPrivateKey);

    return {
      providerId: profile.providerId,
      host: profile.host,
      user: profile.user,
      ...(profile.port !== undefined ? { port: profile.port } : {}),
      ...(profile.database !== undefined ? { database: profile.database } : {}),
      ...(profile.connectTimeoutMs !== undefined
        ? { connectTimeoutMs: profile.connectTimeoutMs }
        : {}),
      ...(credential?.password !== undefined ? { password: credential.password } : {}),
      ...(tls !== undefined ? { tls } : {}),
      ...(profile.options !== undefined ? { options: profile.options } : {}),
    };
  }
}

export function normalizeConnectionProfileDraft(
  draft: ConnectionProfileDraft,
): ConnectionProfileDraft {
  if (!isRecord(draft)) {
    throw new Error("Connection profile must be an object.");
  }

  const id = normalizeProfileId(draft.id);
  const name = requireNonEmptyString(draft.name, "Connection profile name");
  const providerId = requireNonEmptyString(draft.providerId, "Database provider id").toLowerCase();
  const host = requireNonEmptyString(draft.host, "Database host");
  const user = requireString(draft.user, "Database user");
  const port = optionalPositiveInteger(draft.port, "Database port", 65_535);
  const connectTimeoutMs = optionalPositiveInteger(
    draft.connectTimeoutMs,
    "Connection timeout",
    Number.MAX_SAFE_INTEGER,
  );
  const database = optionalNonEmptyString(draft.database, "Database name");
  const credentialId = optionalNonEmptyString(draft.credentialId, "Credential id");
  const tls = normalizeTls(draft.tls);
  const options = normalizeOptions(draft.options);

  return {
    id,
    name,
    providerId,
    host,
    user,
    ...(port !== undefined ? { port } : {}),
    ...(database !== undefined ? { database } : {}),
    ...(connectTimeoutMs !== undefined ? { connectTimeoutMs } : {}),
    ...(tls !== undefined ? { tls } : {}),
    ...(options !== undefined ? { options } : {}),
    ...(credentialId !== undefined ? { credentialId } : {}),
  };
}

function parseStoredProfile(value: unknown, index: number): ConnectionProfile {
  if (!isRecord(value)) {
    throw new Error(`Stored connection profile at index ${index} is not an object.`);
  }

  const draft = normalizeConnectionProfileDraft(value as unknown as ConnectionProfileDraft);
  const revision = value.revision;
  assertPositiveInteger(revision, `Stored connection profile '${draft.id}' revision`);
  const createdAt = requireNonEmptyString(
    value.createdAt,
    `Stored connection profile '${draft.id}' createdAt`,
  );
  const updatedAt = requireNonEmptyString(
    value.updatedAt,
    `Stored connection profile '${draft.id}' updatedAt`,
  );

  return { ...draft, revision, createdAt, updatedAt };
}

function normalizeTls(value: ConnectionProfileTls | undefined): ConnectionProfileTls | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("Connection TLS settings must be an object.");
  }

  const ca = optionalString(value.ca, "TLS CA");
  const cert = optionalString(value.cert, "TLS certificate");
  const rejectUnauthorized = value.rejectUnauthorized;
  if (rejectUnauthorized !== undefined && typeof rejectUnauthorized !== "boolean") {
    throw new Error("TLS rejectUnauthorized must be a boolean.");
  }

  return {
    ...(ca !== undefined ? { ca } : {}),
    ...(cert !== undefined ? { cert } : {}),
    ...(rejectUnauthorized !== undefined ? { rejectUnauthorized } : {}),
  };
}

function normalizeOptions(
  value: Readonly<Record<string, JsonValue>> | undefined,
): Readonly<Record<string, JsonValue>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error("Connection options must be a JSON object.");
  }

  assertJsonValue(value, "options");
  assertNoSecretKeys(value, "options");
  return JSON.parse(JSON.stringify(value)) as Readonly<Record<string, JsonValue>>;
}

function normalizeCredential(value: ConnectionCredential): ConnectionCredential {
  if (!isRecord(value)) {
    throw new Error("Credential must be an object.");
  }
  const password = optionalString(value.password, "Credential password");
  const tlsPrivateKey = optionalString(value.tlsPrivateKey, "Credential TLS private key");
  return {
    ...(password !== undefined ? { password } : {}),
    ...(tlsPrivateKey !== undefined ? { tlsPrivateKey } : {}),
  };
}

function createTlsConfig(
  profileTls: ConnectionProfileTls | undefined,
  tlsPrivateKey: string | undefined,
): DatabaseTlsConfig | undefined {
  if (profileTls === undefined && tlsPrivateKey === undefined) {
    return undefined;
  }

  return {
    ...(profileTls?.ca !== undefined ? { ca: profileTls.ca } : {}),
    ...(profileTls?.cert !== undefined ? { cert: profileTls.cert } : {}),
    ...(tlsPrivateKey !== undefined ? { key: tlsPrivateKey } : {}),
    ...(profileTls?.rejectUnauthorized !== undefined
      ? { rejectUnauthorized: profileTls.rejectUnauthorized }
      : {}),
  };
}

function assertNoSecretKeys(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoSecretKeys(entry, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) {
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (
      normalized === "password" ||
      normalized === "passwd" ||
      normalized === "pwd" ||
      normalized === "secret" ||
      normalized === "token" ||
      normalized === "accesstoken" ||
      normalized === "refreshtoken" ||
      normalized === "apikey" ||
      normalized === "privatekey"
    ) {
      throw new Error(
        `Connection option '${path}.${key}' looks secret and must be stored through CredentialStore.`,
      );
    }
    assertNoSecretKeys(child, `${path}.${key}`);
  }
}

function assertJsonValue(value: unknown, path: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Connection option '${path}' must contain only finite JSON numbers.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${path}[${index}]`));
    return;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      assertJsonValue(child, `${path}.${key}`);
    }
    return;
  }
  throw new Error(`Connection option '${path}' must be JSON-serializable.`);
}

function normalizeProfileId(value: unknown): string {
  const id = requireNonEmptyString(value, "Connection profile id");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    throw new Error(
      "Connection profile id may contain only letters, numbers, dot, underscore and hyphen.",
    );
  }
  return id;
}

function normalizeCredentialId(value: unknown): string {
  return requireNonEmptyString(value, "Credential id");
}

function optionalPositiveInteger(
  value: unknown,
  label: string,
  maximum: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0 || value > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
}

function optionalNonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireNonEmptyString(value, label);
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, label);
}

function requireNonEmptyString(value: unknown, label: string): string {
  const text = requireString(value, label).trim();
  if (!text) {
    throw new Error(`${label} cannot be empty.`);
  }
  return text;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

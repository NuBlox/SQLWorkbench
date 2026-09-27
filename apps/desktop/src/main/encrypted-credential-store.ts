import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type {
  ConnectionCredential,
  CredentialStore,
} from "@nublox/workbench-connection-profiles";

export interface SecretCipher {
  isAvailable(): boolean;
  encrypt(value: string): Buffer;
  decrypt(value: Buffer): string;
}

interface EncryptedCredential {
  readonly password?: string;
  readonly tlsPrivateKey?: string;
}

interface CredentialSnapshot {
  readonly version: 1;
  readonly credentials: Readonly<Record<string, EncryptedCredential>>;
}

/**
 * Stores only ciphertext on disk. Electron safeStorage is injected as SecretCipher
 * by the desktop main process, keeping this class testable without Electron.
 */
export class EncryptedFileCredentialStore implements CredentialStore {
  readonly #filePath: string;
  readonly #cipher: SecretCipher;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(filePath: string, cipher: SecretCipher) {
    const normalizedPath = filePath.trim();
    if (!normalizedPath) throw new Error("Credential file path cannot be empty.");
    this.#filePath = normalizedPath;
    this.#cipher = cipher;
  }

  async get(id: string): Promise<ConnectionCredential | undefined> {
    this.#requireEncryption();
    await this.#mutationTail;
    const credentialId = normalizeCredentialId(id);
    const snapshot = await this.#readSnapshot();
    const stored = snapshot.credentials[credentialId];
    if (!stored) return undefined;

    return {
      ...(stored.password !== undefined
        ? { password: this.#decrypt(stored.password) }
        : {}),
      ...(stored.tlsPrivateKey !== undefined
        ? { tlsPrivateKey: this.#decrypt(stored.tlsPrivateKey) }
        : {}),
    };
  }

  set(id: string, credential: ConnectionCredential): Promise<void> {
    this.#requireEncryption();
    const credentialId = normalizeCredentialId(id);
    const normalized = normalizeCredential(credential);

    return this.#enqueueMutation(async () => {
      const snapshot = await this.#readSnapshot();
      const credentials = { ...snapshot.credentials };
      credentials[credentialId] = {
        ...(normalized.password !== undefined
          ? { password: this.#encrypt(normalized.password) }
          : {}),
        ...(normalized.tlsPrivateKey !== undefined
          ? { tlsPrivateKey: this.#encrypt(normalized.tlsPrivateKey) }
          : {}),
      };
      await this.#writeSnapshot({ version: 1, credentials });
    });
  }

  delete(id: string): Promise<void> {
    this.#requireEncryption();
    const credentialId = normalizeCredentialId(id);

    return this.#enqueueMutation(async () => {
      const snapshot = await this.#readSnapshot();
      if (!(credentialId in snapshot.credentials)) return;
      const credentials = { ...snapshot.credentials };
      delete credentials[credentialId];
      await this.#writeSnapshot({ version: 1, credentials });
    });
  }

  #requireEncryption(): void {
    if (!this.#cipher.isAvailable()) {
      throw new Error(
        "Secure operating-system encryption is unavailable. Credentials will not be stored.",
      );
    }
  }

  #encrypt(value: string): string {
    return this.#cipher.encrypt(value).toString("base64");
  }

  #decrypt(value: string): string {
    return this.#cipher.decrypt(Buffer.from(value, "base64"));
  }

  async #readSnapshot(): Promise<CredentialSnapshot> {
    let content: string;
    try {
      content = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        return { version: 1, credentials: {} };
      }
      throw error;
    }

    let value: unknown;
    try {
      value = JSON.parse(content) as unknown;
    } catch (error) {
      throw new Error(`Credential file '${this.#filePath}' contains invalid JSON.`, {
        cause: error,
      });
    }

    if (!isRecord(value) || value.version !== 1 || !isRecord(value.credentials)) {
      throw new Error(`Credential file '${this.#filePath}' has an unsupported format.`);
    }

    const credentials: Record<string, EncryptedCredential> = {};
    for (const [id, entry] of Object.entries(value.credentials)) {
      if (!isRecord(entry)) {
        throw new Error(`Credential '${id}' has an invalid stored value.`);
      }
      if (entry.password !== undefined && typeof entry.password !== "string") {
        throw new Error(`Credential '${id}' has an invalid password ciphertext.`);
      }
      if (entry.tlsPrivateKey !== undefined && typeof entry.tlsPrivateKey !== "string") {
        throw new Error(`Credential '${id}' has an invalid TLS key ciphertext.`);
      }
      credentials[normalizeCredentialId(id)] = {
        ...(typeof entry.password === "string" ? { password: entry.password } : {}),
        ...(typeof entry.tlsPrivateKey === "string"
          ? { tlsPrivateKey: entry.tlsPrivateKey }
          : {}),
      };
    }

    return { version: 1, credentials };
  }

  async #writeSnapshot(snapshot: CredentialSnapshot): Promise<void> {
    const directory = dirname(this.#filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
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

function normalizeCredentialId(value: string): string {
  const id = value.trim();
  if (!id) throw new Error("Credential id cannot be empty.");
  return id;
}

function normalizeCredential(value: ConnectionCredential): ConnectionCredential {
  const password = normalizeSecret(value.password);
  const tlsPrivateKey = normalizeSecret(value.tlsPrivateKey);
  if (password === undefined && tlsPrivateKey === undefined) {
    throw new Error("At least one credential secret must be provided.");
  }
  return {
    ...(password !== undefined ? { password } : {}),
    ...(tlsPrivateKey !== undefined ? { tlsPrivateKey } : {}),
  };
}

function normalizeSecret(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasErrorCode(value: unknown, code: string): boolean {
  return isRecord(value) && value.code === code;
}

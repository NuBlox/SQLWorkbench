import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { QueryHistoryEntry } from "../lib/desktop-api.js";

interface QueryHistorySnapshot {
  readonly version: 1;
  readonly entries: readonly QueryHistoryEntry[];
}

export class QueryHistoryStore {
  readonly #filePath: string;
  readonly #maxEntries: number;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(filePath: string, maxEntries = 250) {
    if (!filePath.trim()) throw new Error("Query history file path cannot be empty.");
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error("Query history maximum entries must be a positive whole number.");
    }
    this.#filePath = filePath;
    this.#maxEntries = maxEntries;
  }

  async list(limit = 100): Promise<readonly QueryHistoryEntry[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("Query history limit must be a positive whole number.");
    }
    await this.#mutationTail;
    return (await this.#read()).slice(0, limit);
  }

  add(entry: QueryHistoryEntry): Promise<void> {
    return this.#enqueue(async () => {
      const entries = await this.#read();
      await this.#write([entry, ...entries].slice(0, this.#maxEntries));
    });
  }

  clear(): Promise<void> {
    return this.#enqueue(async () => {
      await this.#write([]);
    });
  }

  async #read(): Promise<QueryHistoryEntry[]> {
    let content: string;
    try {
      content = await readFile(this.#filePath, "utf8");
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) return [];
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content) as unknown;
    } catch (error) {
      throw new Error(`Query history file '${this.#filePath}' contains invalid JSON.`, { cause: error });
    }

    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      throw new Error(`Query history file '${this.#filePath}' has an unsupported format.`);
    }

    return parsed.entries.map(parseEntry);
  }

  async #write(entries: readonly QueryHistoryEntry[]): Promise<void> {
    const directory = dirname(this.#filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const snapshot: QueryHistorySnapshot = { version: 1, entries };
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

  async #enqueue(operation: () => Promise<void>): Promise<void> {
    const previous = this.#mutationTail;
    let release: () => void = () => undefined;
    this.#mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      await operation();
    } finally {
      release();
    }
  }
}

function parseEntry(value: unknown, index: number): QueryHistoryEntry {
  if (!isRecord(value)) throw new Error(`Query history entry ${index} is invalid.`);
  const status = value.status;
  const mode = value.mode;
  if (status !== "success" && status !== "error" && status !== "cancelled") {
    throw new Error(`Query history entry ${index} has an invalid status.`);
  }
  if (mode !== "statement" && mode !== "selection" && mode !== "script") {
    throw new Error(`Query history entry ${index} has an invalid run mode.`);
  }

  return {
    id: requireString(value.id, "id", index),
    connectionId: requireString(value.connectionId, "connectionId", index),
    mode,
    sql: requireString(value.sql, "sql", index),
    startedAt: requireString(value.startedAt, "startedAt", index),
    elapsedMs: requireNonNegativeNumber(value.elapsedMs, "elapsedMs", index),
    status,
    statementCount: requireNonNegativeNumber(value.statementCount, "statementCount", index),
    resultSetCount: requireNonNegativeNumber(value.resultSetCount, "resultSetCount", index),
    ...(typeof value.message === "string" ? { message: value.message } : {}),
  };
}

function requireString(value: unknown, name: string, index: number): string {
  if (typeof value !== "string") {
    throw new Error(`Query history entry ${index} field '${name}' must be a string.`);
  }
  return value;
}

function requireNonNegativeNumber(value: unknown, name: string, index: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Query history entry ${index} field '${name}' must be a non-negative number.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

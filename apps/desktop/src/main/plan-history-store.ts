import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { QueryPlanHistoryEntry, QueryPlanView } from "../lib/desktop-api.js";

interface Snapshot {
  readonly version: 1;
  readonly entries: readonly QueryPlanHistoryEntry[];
}

export interface AddPlanHistoryInput {
  readonly connectionId: string;
  readonly sql: string;
  readonly capturedAt: string;
  readonly explainElapsedMs: number;
  readonly plan: QueryPlanView;
}

export class QueryPlanHistoryStore {
  readonly #filePath: string;
  readonly #maxEntries: number;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(filePath: string, maxEntries = 250) {
    if (!filePath.trim()) throw new Error("Plan history file path cannot be empty.");
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) throw new Error("Plan history maximum entries must be a positive whole number.");
    this.#filePath = filePath;
    this.#maxEntries = maxEntries;
  }

  async list(limit = 100): Promise<readonly QueryPlanHistoryEntry[]> {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("Plan history limit must be a positive whole number.");
    await this.#mutationTail;
    return (await this.#read()).slice(0, limit);
  }

  add(input: AddPlanHistoryInput): Promise<QueryPlanHistoryEntry> {
    const entry: QueryPlanHistoryEntry = {
      id: randomUUID(),
      connectionId: requireText(input.connectionId, "Connection id"),
      sql: requireText(input.sql, "SQL"),
      sqlFingerprint: fingerprintSql(input.sql),
      capturedAt: input.capturedAt,
      explainElapsedMs: nonNegative(input.explainElapsedMs, "Explain elapsed time"),
      plan: input.plan,
    };
    return this.#enqueue(async () => {
      const entries = await this.#read();
      await this.#write([entry, ...entries].slice(0, this.#maxEntries));
      return entry;
    });
  }

  clear(): Promise<void> { return this.#enqueue(async () => this.#write([])); }

  async #read(): Promise<QueryPlanHistoryEntry[]> {
    let content: string;
    try { content = await readFile(this.#filePath, "utf8"); }
    catch (error) { if (hasCode(error, "ENOENT")) return []; throw error; }
    const parsed = JSON.parse(content) as unknown;
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new Error(`Plan history file '${this.#filePath}' has an unsupported format.`);
    return parsed.entries.map(parseEntry);
  }

  async #write(entries: readonly QueryPlanHistoryEntry[]): Promise<void> {
    const directory = dirname(this.#filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const tempPath = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;
    const snapshot: Snapshot = { version: 1, entries };
    try {
      await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tempPath, this.#filePath);
    } finally { await rm(tempPath, { force: true }).catch(() => undefined); }
  }

  async #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#mutationTail;
    let release: () => void = () => undefined;
    this.#mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }
}

/**
 * Keeps SQL identity semantically conservative: surrounding whitespace and terminal
 * delimiters do not change identity, while whitespace inside the statement remains
 * significant because it may occur inside string literals.
 */
export function normalizeSqlIdentity(sql: string): string {
  return sql.trim().replace(/;+\s*$/u, "");
}

export function fingerprintSql(sql: string): string {
  return createHash("sha256").update(normalizeSqlIdentity(sql), "utf8").digest("hex");
}

function parseEntry(value: unknown, index: number): QueryPlanHistoryEntry {
  if (!isRecord(value) || !isRecord(value.plan)) throw new Error(`Plan history entry ${index} is invalid.`);
  return {
    id: stringField(value.id, "id", index),
    connectionId: stringField(value.connectionId, "connectionId", index),
    sql: stringField(value.sql, "sql", index),
    sqlFingerprint: stringField(value.sqlFingerprint, "sqlFingerprint", index),
    capturedAt: stringField(value.capturedAt, "capturedAt", index),
    explainElapsedMs: numberField(value.explainElapsedMs, "explainElapsedMs", index),
    plan: value.plan as unknown as QueryPlanView,
  };
}
function requireText(value: string, label: string): string { const normalized = value.trim(); if (!normalized) throw new Error(`${label} cannot be empty.`); return normalized; }
function nonNegative(value: number, label: string): number { if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be non-negative.`); return value; }
function stringField(value: unknown, field: string, index: number): string { if (typeof value !== "string") throw new Error(`Plan history entry ${index} field '${field}' must be a string.`); return value; }
function numberField(value: unknown, field: string, index: number): number { if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`Plan history entry ${index} field '${field}' must be a non-negative number.`); return value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasCode(value: unknown, code: string): boolean { return isRecord(value) && value.code === code; }

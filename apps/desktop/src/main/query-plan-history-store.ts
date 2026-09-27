import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { QueryPlanHistoryEntry } from "@nublox/workbench-query-engineering/query-plan-history";
import type { QueryPlanNode, QueryPlanProperty, QueryPlanView } from "@nublox/workbench-query-engineering/explain-plan";

interface QueryPlanHistorySnapshot {
  readonly version: 1;
  readonly entries: readonly QueryPlanHistoryEntry[];
}

export class QueryPlanHistoryStore {
  readonly #filePath: string;
  readonly #maxEntries: number;
  #mutationTail: Promise<void> = Promise.resolve();

  constructor(filePath: string, maxEntries = 100) {
    if (!filePath.trim()) throw new Error("Query plan history file path cannot be empty.");
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw new Error("Query plan history maximum entries must be a positive whole number.");
    }
    this.#filePath = filePath;
    this.#maxEntries = maxEntries;
  }

  async list(limit = 50): Promise<readonly QueryPlanHistoryEntry[]> {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("Query plan history limit must be a positive whole number.");
    }
    await this.#mutationTail;
    return (await this.#read()).slice(0, limit);
  }

  add(entry: QueryPlanHistoryEntry): Promise<void> {
    return this.#enqueue(async () => {
      const entries = await this.#read();
      const deduplicated = entries.filter((candidate) => candidate.id !== entry.id);
      await this.#write([entry, ...deduplicated].slice(0, this.#maxEntries));
    });
  }

  clear(): Promise<void> {
    return this.#enqueue(async () => this.#write([]));
  }

  async #read(): Promise<QueryPlanHistoryEntry[]> {
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
      throw new Error(`Query plan history file '${this.#filePath}' contains invalid JSON.`, { cause: error });
    }

    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      throw new Error(`Query plan history file '${this.#filePath}' has an unsupported format.`);
    }
    return parsed.entries.map(parseEntry);
  }

  async #write(entries: readonly QueryPlanHistoryEntry[]): Promise<void> {
    const directory = dirname(this.#filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const snapshot: QueryPlanHistorySnapshot = { version: 1, entries };
    const tempPath = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tempPath, this.#filePath);
    } finally {
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  async #enqueue(operation: () => Promise<void>): Promise<void> {
    const previous = this.#mutationTail;
    let release: () => void = () => undefined;
    this.#mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { await operation(); }
    finally { release(); }
  }
}

function parseEntry(value: unknown, index: number): QueryPlanHistoryEntry {
  if (!isRecord(value)) throw new Error(`Query plan history entry ${index} is invalid.`);
  return {
    id: requireString(value.id, "id", index),
    connectionId: requireString(value.connectionId, "connectionId", index),
    providerId: requireString(value.providerId, "providerId", index),
    sql: requireString(value.sql, "sql", index),
    fingerprint: requireString(value.fingerprint, "fingerprint", index),
    capturedAt: requireString(value.capturedAt, "capturedAt", index),
    plan: parsePlan(value.plan, index),
  };
}

function parsePlan(value: unknown, index: number): QueryPlanView {
  if (!isRecord(value)) throw new Error(`Query plan history entry ${index} plan is invalid.`);
  return {
    providerId: requireString(value.providerId, "plan.providerId", index),
    format: requireString(value.format, "plan.format", index),
    root: parseNode(value.root, index, "root"),
    nodeCount: requireNonNegativeNumber(value.nodeCount, "plan.nodeCount", index),
    ...(value.queryCost !== undefined ? { queryCost: requireNonNegativeNumber(value.queryCost, "plan.queryCost", index) } : {}),
  };
}

function parseNode(value: unknown, index: number, path: string): QueryPlanNode {
  if (!isRecord(value)) throw new Error(`Query plan history entry ${index} node '${path}' is invalid.`);
  if (!Array.isArray(value.properties) || !Array.isArray(value.children)) {
    throw new Error(`Query plan history entry ${index} node '${path}' is incomplete.`);
  }
  return {
    id: requireString(value.id, `${path}.id`, index),
    kind: requireString(value.kind, `${path}.kind`, index),
    label: requireString(value.label, `${path}.label`, index),
    ...(typeof value.subtitle === "string" ? { subtitle: value.subtitle } : {}),
    ...(value.estimatedRows !== undefined ? { estimatedRows: requireNonNegativeNumber(value.estimatedRows, `${path}.estimatedRows`, index) } : {}),
    ...(value.estimatedCost !== undefined ? { estimatedCost: requireNonNegativeNumber(value.estimatedCost, `${path}.estimatedCost`, index) } : {}),
    ...(value.filteredPercent !== undefined ? { filteredPercent: requireNonNegativeNumber(value.filteredPercent, `${path}.filteredPercent`, index) } : {}),
    ...(typeof value.accessType === "string" ? { accessType: value.accessType } : {}),
    ...(typeof value.keyUsed === "string" ? { keyUsed: value.keyUsed } : {}),
    properties: value.properties.map((property, propertyIndex) => parseProperty(property, index, `${path}.properties[${propertyIndex}]`)),
    children: value.children.map((child, childIndex) => parseNode(child, index, `${path}.children[${childIndex}]`)),
  };
}

function parseProperty(value: unknown, index: number, path: string): QueryPlanProperty {
  if (!isRecord(value)) throw new Error(`Query plan history entry ${index} property '${path}' is invalid.`);
  return {
    key: requireString(value.key, `${path}.key`, index),
    label: requireString(value.label, `${path}.label`, index),
    value: requireString(value.value, `${path}.value`, index),
  };
}

function requireString(value: unknown, name: string, index: number): string {
  if (typeof value !== "string") throw new Error(`Query plan history entry ${index} field '${name}' must be a string.`);
  return value;
}

function requireNonNegativeNumber(value: unknown, name: string, index: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Query plan history entry ${index} field '${name}' must be a non-negative number.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

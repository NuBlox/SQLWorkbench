import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { MemoryCredentialStore } from "@nublox/workbench-connection-profiles";
import { ConnectionManager, ProviderRegistry } from "@nublox/workbench-core";

import { QueryHistoryStore } from "../dist/electron/main/query-history-store.js";
import { DesktopServices } from "../dist/electron/main/services.js";

function profileRepository() {
  return {
    async list() { return []; },
    async get() { return undefined; },
    async create() { throw new Error("not used"); },
    async update() { throw new Error("not used"); },
    async delete() {},
  };
}

function fakeProvider() {
  return {
    id: "fake",
    displayName: "Fake",
    capabilities: {
      catalogIntrospection: false,
      schemas: false,
      views: false,
      indexes: false,
      foreignKeys: false,
      procedures: false,
      functions: false,
      triggers: false,
      partitions: false,
      transactions: true,
      savepoints: false,
      explainPlan: false,
      queryCancellation: true,
      serverAdministration: false,
      userAdministration: false,
    },
    async connect() {
      return {
        id: "session",
        providerId: "fake",
        connectedAt: new Date(0).toISOString(),
        async health() { return { ok: true }; },
        async close() {},
      };
    },
    async introspect() { throw new Error("not used"); },
    async execute(_session, request) {
      if (request.sql.includes("WAIT")) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 5_000);
          if (request.signal?.aborted) {
            clearTimeout(timer);
            reject(request.signal.reason);
            return;
          }
          request.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(request.signal?.reason);
          }, { once: true });
        });
      }
      return {
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(0).toISOString(),
        elapsedMs: 0,
        resultSets: [{ columns: [{ name: "sql" }], rows: [{ sql: request.sql }] }],
      };
    },
    async explain() { throw new Error("not used"); },
    quoteIdentifier(value) { return `\"${value}\"`; },
  };
}

async function createServices() {
  const directory = await mkdtemp(join(tmpdir(), "nublox-services-"));
  const registry = new ProviderRegistry();
  registry.register(fakeProvider());
  const connections = new ConnectionManager(registry);
  await connections.connect("dev", { providerId: "fake", host: "localhost", user: "test" });
  const history = new QueryHistoryStore(join(directory, "history.json"));
  const services = new DesktopServices(profileRepository(), new MemoryCredentialStore(), connections, history);
  return { directory, history, services };
}

test("script execution runs split statements and aggregates result sets", async () => {
  const { directory, history, services } = await createServices();
  const execution = await services.executeQuery({
    executionId: "script-1",
    connectionId: "dev",
    mode: "script",
    sql: "SELECT ';' AS semi; SELECT 2;",
  });

  assert.equal(execution.statementCount, 2);
  assert.equal(execution.resultSets.length, 2);
  assert.equal(execution.resultSets[0].rows[0].sql, "SELECT ';' AS semi");
  assert.equal((await history.list())[0].status, "success");
  await rm(directory, { recursive: true, force: true });
});

test("active query cancellation aborts the provider signal and records cancellation", async () => {
  const { directory, history, services } = await createServices();
  const execution = services.executeQuery({
    executionId: "slow-1",
    connectionId: "dev",
    mode: "statement",
    sql: "SELECT WAIT",
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(services.cancelQuery("slow-1"), true);
  await assert.rejects(execution, /cancelled/i);
  assert.equal((await history.list())[0].status, "cancelled");
  await rm(directory, { recursive: true, force: true });
});

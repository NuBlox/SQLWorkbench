import assert from "node:assert/strict";
import test from "node:test";

import { ConnectionManager, ProviderRegistry } from "@nublox/workbench-core";
import { DesktopAdministrationService } from "../dist/electron/main/administration-service.js";

function provider(withAdministration = true) {
  const session = { id: "server", providerId: "test", connectedAt: new Date(0).toISOString(), health: async () => ({ ok: true }), close: async () => {} };
  const administrationCapabilities = {
    sessions: true,
    locks: true,
    serverVariables: true,
    serverStatus: true,
    users: false,
    storage: false,
    importExport: false,
    backupRestore: false,
    dataTransfer: false,
  };
  return {
    id: "test",
    displayName: "Test",
    capabilities: {
      catalogIntrospection: false, schemas: false, views: false, indexes: false, foreignKeys: false,
      procedures: false, functions: false, triggers: false, partitions: false, transactions: true,
      savepoints: true, explainPlan: false, queryCancellation: false, serverAdministration: withAdministration,
      userAdministration: false,
      ...(withAdministration ? { administration: administrationCapabilities } : {}),
    },
    ...(withAdministration ? {
      administration: {
        providerId: "test",
        capabilities: administrationCapabilities,
        async listSessions() { return [{ id: "7", user: "app", command: "Query", timeSeconds: 1 }]; },
        async listLockWaits() { return [{ waitingSessionId: "8", blockingSessionId: "7", object: "nublox.orders", lockType: "RECORD", lockMode: "X" }]; },
        async listServerVariables(_session, filter) { return [{ name: "filter", value: filter ?? "" }]; },
        async listServerStatus(_session, filter) { return [{ name: "status", value: filter ?? "" }]; },
      },
    } : {}),
    async connect() { return session; },
    async introspect() { throw new Error("unused"); },
    async execute() { throw new Error("unused"); },
    async explain() { throw new Error("unused"); },
    quoteIdentifier(value) { return value; },
  };
}

async function connected(withAdministration = true) {
  const registry = new ProviderRegistry();
  registry.register(provider(withAdministration));
  const connections = new ConnectionManager(registry);
  await connections.connect("dev", { providerId: "test", host: "localhost", user: "test" });
  return connections;
}

test("desktop administration service forwards sessions, locks, variables and status", async () => {
  const connections = await connected();
  const service = new DesktopAdministrationService(connections);
  assert.equal((await service.listSessions("dev"))[0].id, "7");
  assert.deepEqual(await service.listLockWaits("dev"), [{ waitingSessionId: "8", blockingSessionId: "7", object: "nublox.orders", lockType: "RECORD", lockMode: "X" }]);
  assert.deepEqual(await service.listVariables("dev", " max "), [{ name: "filter", value: "max" }]);
  assert.deepEqual(await service.listStatus("dev", " thread "), [{ name: "status", value: "thread" }]);
  await connections.disconnectAll();
});

test("desktop administration service rejects providers without administration capability", async () => {
  const connections = await connected(false);
  const service = new DesktopAdministrationService(connections);
  await assert.rejects(service.listSessions("dev"), /does not support administration capability 'sessions'/u);
  await connections.disconnectAll();
});

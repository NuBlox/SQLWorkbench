import assert from "node:assert/strict";
import test from "node:test";

import { ConnectionManager, ProviderRegistry } from "@nublox/workbench-core";
import { DesktopOperationsService } from "../dist/electron/main/operations-service.js";

function makeProvider(id, rows = [{ id: 1, value: "a" }]) {
  const session = { id: `${id}-session`, providerId: id, connectedAt: new Date(0).toISOString(), health: async () => ({ ok: true }), close: async () => {} };
  const writes = [];
  return {
    provider: {
      id,
      displayName: id,
      capabilities: {
        catalogIntrospection: false, schemas: false, views: false, indexes: false, foreignKeys: false,
        procedures: false, functions: false, triggers: false, partitions: false, transactions: true,
        savepoints: true, explainPlan: false, queryCancellation: false, serverAdministration: true, userAdministration: true,
        administration: { sessions: true, locks: true, serverVariables: true, serverStatus: true, users: true, storage: true, importExport: true, backupRestore: true, dataTransfer: true },
      },
      administration: {
        providerId: id,
        capabilities: { sessions: true, locks: true, serverVariables: true, serverStatus: true, users: true, storage: true, importExport: true, backupRestore: true, dataTransfer: true },
        async listSessions() { return []; },
        async listServerVariables() { return []; },
        async listServerStatus() { return []; },
        async listSecurityPrincipals() { return [{ grantee: "'app'@'%'", name: "app", host: "%", kind: "user" }]; },
        async listSecurityPrivileges() { return [{ grantee: "'app'@'%'", privilege: "SELECT", scope: "global", grantable: false }]; },
        async listRoleMemberships() { return []; },
        previewSecurityChange(change) { return { providerId: id, statements: [`PREVIEW ${change.kind}`], destructive: change.kind.startsWith("revoke"), warnings: [] }; },
        async applySecurityChange() {},
        async listStorage() { return [{ catalog: "app", table: "items", dataBytes: 10, indexBytes: 2, freeBytes: 0, totalBytes: 12 }]; },
        async readTableRows() { return { columns: [{ name: "id" }, { name: "value" }], rows }; },
        async writeTableRows(_session, request) { writes.push(...request.rows); return { rowsAttempted: request.rows.length, rowsWritten: request.rows.length }; },
      },
      async connect() { return session; },
      async introspect() { throw new Error("unused"); },
      async execute() { throw new Error("unused"); },
      async explain() { throw new Error("unused"); },
      quoteIdentifier(value) { return value; },
    },
    writes,
  };
}

async function setup() {
  const left = makeProvider("left", [{ id: 1, value: "a" }, { id: 2, value: "b" }]);
  const right = makeProvider("right", [{ id: 1, value: "a" }]);
  const registry = new ProviderRegistry();
  registry.register(left.provider); registry.register(right.provider);
  const connections = new ConnectionManager(registry);
  await connections.connect("left", { providerId: "left", host: "localhost", user: "x" });
  await connections.connect("right", { providerId: "right", host: "localhost", user: "x" });
  const profiles = { async list() { return []; }, async get() { return undefined; }, async create() { throw new Error("unused"); }, async update() { throw new Error("unused"); }, async delete() {} };
  const credentials = { async get() { return undefined; }, async set() {}, async delete() {} };
  return { service: new DesktopOperationsService(connections, profiles, credentials), connections, left, right };
}

test("security preview requires matching fingerprint and confirmation", async () => {
  const { service, connections } = await setup();
  const request = { connectionId: "left", change: { kind: "grant-privileges", grantee: "app@%", privileges: ["SELECT"], scope: "global" } };
  const prepared = await service.previewSecurity(request);
  await assert.rejects(service.executeSecurity({ ...request, fingerprint: "stale", confirmation: prepared.guard.confirmationPhrase }), /stale/u);
  await assert.rejects(service.executeSecurity({ ...request, fingerprint: prepared.guard.fingerprint, confirmation: "wrong" }), /Confirmation/u);
  assert.deepEqual(await service.executeSecurity({ ...request, fingerprint: prepared.guard.fingerprint, confirmation: prepared.guard.confirmationPhrase }), { completed: true, statementsExecuted: 1 });
  await connections.disconnectAll();
});

test("compare and transfer are bounded and fingerprint guarded", async () => {
  const { service, connections, right } = await setup();
  const request = { leftConnectionId: "left", leftCatalog: "app", leftTable: "items", rightConnectionId: "right", rightCatalog: "app", rightTable: "items", limit: 100 };
  const comparison = await service.compareData(request);
  assert.equal(comparison.matchingRows, 1);
  assert.equal(comparison.onlyLeft, 1);
  const preview = await service.previewTransfer(request);
  await assert.rejects(service.executeTransfer({ ...request, fingerprint: "stale", confirmation: "TRANSFER DATA" }), /stale/u);
  const result = await service.executeTransfer({ ...request, fingerprint: preview.guard.fingerprint, confirmation: "TRANSFER DATA" });
  assert.equal(result.rowsWritten, 2);
  assert.equal(right.writes.length, 2);
  await connections.disconnectAll();
});

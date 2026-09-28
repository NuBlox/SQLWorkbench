import assert from "node:assert/strict";
import test from "node:test";

import { ConnectionManager, ProviderRegistry } from "@nublox/workbench-core";
import { DesktopAdministrationService } from "../dist/electron/main/administration-service.js";

function provider() {
  const session = { id: "server", providerId: "test", connectedAt: new Date(0).toISOString(), health: async () => ({ ok: true }), close: async () => {} };
  const capabilities = { sessions: true, locks: true, serverVariables: true, serverStatus: true, users: true, storage: true, importExport: true, backupRestore: true, dataTransfer: true };
  let executed = false;
  return {
    provider: {
      id: "test", displayName: "Test",
      capabilities: { catalogIntrospection: false, schemas: false, views: false, indexes: false, foreignKeys: false, procedures: false, functions: false, triggers: false, partitions: false, transactions: true, savepoints: true, explainPlan: false, queryCancellation: false, serverAdministration: true, userAdministration: true, administration: capabilities },
      administration: {
        providerId: "test", capabilities,
        async listSessions() { return []; }, async listLockWaits() { return []; }, async listServerVariables() { return []; }, async listServerStatus() { return []; },
        async listAccounts() { return [{ grantee: "'app'@'%'", user: "app", host: "%", kind: "user" }]; }, async listRoleMemberships() { return []; }, async listPrivilegeGrants() { return []; },
        previewSecurityChange() { return { providerId: "test", statements: ["GRANT SELECT"], destructive: false, confirmation: "APPLY SECURITY CHANGE", warnings: [] }; },
        async executeSecurityChange() { executed = true; },
        async listStorage() { return [{ catalog: "db", tables: 1, estimatedRows: 2, dataBytes: 3, indexBytes: 4, totalBytes: 7 }]; },
        async exportTable() { return { catalog: "db", table: "t", columns: ["id"], rows: [{ id: 1 }] }; },
        async importTable(_session, data) { return { rowsRead: data.rows.length, rowsWritten: data.rows.length, target: `${data.catalog}.${data.table}` }; },
        async compareTables() { return { leftCount: 1, rightCount: 2, matchingColumns: ["id"], leftOnlyColumns: [], rightOnlyColumns: [], rowCountDelta: 1 }; },
        async transferTable() { return { rowsRead: 1, rowsWritten: 1, target: "db.b" }; },
        listBackupHooks() { return [{ id: "json", label: "JSON", available: true, description: "test" }]; },
      },
      async connect() { return session; }, async introspect() { throw new Error("unused"); }, async execute() { throw new Error("unused"); }, async explain() { throw new Error("unused"); }, quoteIdentifier(value) { return value; },
    },
    executed: () => executed,
  };
}

async function connected() {
  const fixture = provider(); const registry = new ProviderRegistry(); registry.register(fixture.provider); const connections = new ConnectionManager(registry); await connections.connect("dev", { providerId: "test", host: "localhost", user: "test" }); return { service: new DesktopAdministrationService(connections), connections, fixture };
}

test("security execution requires exact preview confirmation", async () => {
  const { service, connections, fixture } = await connected();
  const change = { kind: "grant-privilege", grantee: "'app'@'%'", privilege: "SELECT", scope: "global" };
  await assert.rejects(service.executeSecurityChange("dev", change, "yes"), /Confirmation must exactly match/u);
  assert.equal(fixture.executed(), false);
  await service.executeSecurityChange("dev", change, "APPLY SECURITY CHANGE");
  assert.equal(fixture.executed(), true);
  await connections.disconnectAll();
});

test("data transfer is separately confirmation guarded", async () => {
  const { service, connections } = await connected();
  const request = { sourceCatalog: "db", sourceTable: "a", targetCatalog: "db", targetTable: "b" };
  await assert.rejects(service.transferTable("dev", request, "copy"), /TRANSFER DATA/u);
  assert.equal((await service.transferTable("dev", request, "TRANSFER DATA")).rowsWritten, 1);
  assert.equal((await service.listStorage("dev"))[0].totalBytes, 7);
  assert.equal(service.listBackupHooks("dev")[0].available, true);
  await connections.disconnectAll();
});

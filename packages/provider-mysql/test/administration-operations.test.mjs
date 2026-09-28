import assert from "node:assert/strict";
import test from "node:test";

import { MySqlAdministrationProvider, mysqlAdministrationCapabilities } from "../dist/administration.js";

const session = { id: "session", providerId: "mysql", connectedAt: new Date(0).toISOString(), health: async () => ({ ok: true }), close: async () => {} };
function execution(rows = [], columns = []) { return { startedAt: new Date(0).toISOString(), finishedAt: new Date(0).toISOString(), elapsedMs: 0, resultSets: [{ columns, rows }] }; }

test("MySQL RC administration advertises all M6 capabilities", () => {
  assert.deepEqual(mysqlAdministrationCapabilities, {
    sessions: true, locks: true, serverVariables: true, serverStatus: true,
    users: true, storage: true, importExport: true, backupRestore: true, dataTransfer: true,
  });
});

test("security preview validates and quotes MySQL account changes", () => {
  const provider = new MySqlAdministrationProvider({ execute: async () => execution() });
  assert.deepEqual(provider.previewSecurityChange({ kind: "grant-privilege", grantee: "'app'@'localhost'", privilege: "select", scope: "table", catalog: "nublox", table: "orders", withGrantOption: true }), {
    providerId: "mysql",
    statements: ["GRANT SELECT ON `nublox`.`orders` TO 'app'@'localhost' WITH GRANT OPTION"],
    destructive: false,
    confirmation: "APPLY SECURITY CHANGE",
    warnings: [],
  });
  assert.equal(provider.previewSecurityChange({ kind: "revoke-role", grantee: "'app'@'localhost'", role: "'reporting'@'%'" }).confirmation, "APPLY SECURITY REVOKE");
  assert.throws(() => provider.previewSecurityChange({ kind: "grant-privilege", grantee: "app", privilege: "SELECT; DROP USER root", scope: "global" }), /Account must use MySQL/u);
});

test("storage inspection normalizes capacity values", async () => {
  const provider = new MySqlAdministrationProvider({
    async execute(_session, request) {
      assert.match(request.sql, /INFORMATION_SCHEMA\.TABLES/u);
      return execution([{ catalogName: "nublox", tableCount: "4", estimatedRows: "100", dataBytes: "1024", indexBytes: "512", totalBytes: "1536" }]);
    },
  });
  assert.deepEqual(await provider.listStorage(session), [{ catalog: "nublox", tables: 4, estimatedRows: 100, dataBytes: 1024, indexBytes: 512, totalBytes: 1536 }]);
});

test("logical export and import use quoted identifiers and prepared inserts", async () => {
  const calls = [];
  const provider = new MySqlAdministrationProvider({
    async execute(_session, request) {
      calls.push(request);
      if (request.sql.startsWith("SELECT *")) return execution([{ id: 1, name: "A" }], [{ name: "id" }, { name: "name" }]);
      return execution();
    },
  });
  const data = await provider.exportTable(session, "nublox", "orders", 50);
  assert.deepEqual(data.columns, ["id", "name"]);
  assert.equal(data.rows.length, 1);
  const result = await provider.importTable(session, { ...data, catalog: "copydb", table: "orders_copy" }, true);
  assert.equal(result.rowsWritten, 1);
  assert.match(calls[1].sql, /TRUNCATE TABLE `copydb`\.`orders_copy`/u);
  assert.equal(calls[2].mode, "prepared");
  assert.deepEqual(calls[2].values, [1, "A"]);
});

test("backup hook discovery never claims unconfigured mysqldump is executable", () => {
  const provider = new MySqlAdministrationProvider({ execute: async () => execution() });
  const hooks = provider.listBackupHooks();
  assert.equal(hooks.find((hook) => hook.id === "workbench-json")?.available, true);
  assert.equal(hooks.find((hook) => hook.id === "mysqldump")?.available, false);
});

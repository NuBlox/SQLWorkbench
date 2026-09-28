import assert from "node:assert/strict";
import test from "node:test";

import { MySqlAdministrationProvider, mysqlAdministrationCapabilities } from "../dist/administration.js";

const session = { id: "session", providerId: "mysql", connectedAt: new Date(0).toISOString(), health: async () => ({ ok: true }), close: async () => {} };

function execution(rows, extras = {}) {
  return {
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(0).toISOString(),
    elapsedMs: 0,
    resultSets: [{ columns: [], rows, ...extras }],
  };
}

function provider(execute) {
  return new MySqlAdministrationProvider({
    execute,
    quoteIdentifier(value) { return `\`${String(value).replaceAll("`", "``")}\``; },
  });
}

test("MySQL administration provider advertises RC operational capabilities", () => {
  assert.equal(mysqlAdministrationCapabilities.locks, true);
  assert.equal(mysqlAdministrationCapabilities.users, true);
  assert.equal(mysqlAdministrationCapabilities.storage, true);
  assert.equal(mysqlAdministrationCapabilities.importExport, true);
  assert.equal(mysqlAdministrationCapabilities.backupRestore, true);
  assert.equal(mysqlAdministrationCapabilities.dataTransfer, true);
});

test("MySQL administration provider maps processlist rows", async () => {
  const administration = provider(async (_session, request) => {
    assert.match(request.sql, /INFORMATION_SCHEMA\.PROCESSLIST/u);
    return execution([
      { sessionId: 42, userName: "app", hostName: "localhost:53122", databaseName: "nublox", commandName: "Query", timeSeconds: 7, stateName: "executing", statementText: "SELECT 1" },
      { sessionId: 43, userName: "system user", hostName: null, databaseName: null, commandName: "Daemon", timeSeconds: "2", stateName: null, statementText: null },
    ]);
  });
  const sessions = await administration.listSessions(session);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].id, "42");
  assert.equal(sessions[1].database, undefined);
});

test("MySQL administration provider maps blocking lock waits", async () => {
  const administration = provider(async (_session, request) => {
    assert.match(request.sql, /performance_schema\.data_lock_waits/u);
    assert.match(request.sql, /INFORMATION_SCHEMA\.INNODB_TRX/u);
    return execution([{ waitingSessionId: 51, blockingSessionId: 42, objectName: "nublox.orders", lockType: "RECORD", lockMode: "X,REC_NOT_GAP", waitSeconds: "12", statementText: "UPDATE orders SET status='paid' WHERE id=7" }]);
  });
  assert.deepEqual(await administration.listLockWaits(session), [{ waitingSessionId: "51", blockingSessionId: "42", object: "nublox.orders", lockType: "RECORD", lockMode: "X,REC_NOT_GAP", waitSeconds: 12, statement: "UPDATE orders SET status='paid' WHERE id=7" }]);
});

test("MySQL administration provider maps and filters global variables/status", async () => {
  const administration = provider(async (_session, request) => {
    if (request.sql === "SHOW GLOBAL VARIABLES") return execution([{ Variable_name: "max_connections", Value: "151" }, { Variable_name: "sql_mode", Value: "STRICT_TRANS_TABLES" }]);
    if (request.sql === "SHOW GLOBAL STATUS") return execution([{ Variable_name: "Threads_connected", Value: "4" }, { Variable_name: "Uptime", Value: "3600" }]);
    throw new Error(`Unexpected SQL: ${request.sql}`);
  });
  assert.deepEqual(await administration.listServerVariables(session, "connection"), [{ name: "max_connections", value: "151" }]);
  assert.deepEqual(await administration.listServerStatus(session, "thread"), [{ name: "Threads_connected", value: "4" }]);
});

test("MySQL administration provider maps security principals, privileges and roles", async () => {
  const administration = provider(async (_session, request) => {
    if (request.sql.includes("FROM mysql.user")) return execution([{ userName: "app", hostName: "%", accountLocked: "N", passwordExpired: "N", authenticationPlugin: "caching_sha2_password", principalKind: "user" }]);
    if (request.sql.includes("INFORMATION_SCHEMA.USER_PRIVILEGES")) return execution([{ grantee: "'app'@'%'", privilegeType: "SELECT", scopeName: "schema", schemaName: "nublox", tableName: null, columnName: null, isGrantable: "NO" }]);
    if (request.sql.includes("FROM mysql.role_edges")) return execution([{ roleName: "reader", roleHost: "%", granteeName: "app", granteeHost: "%", adminOption: "N", defaultRole: "Y" }]);
    throw new Error(`Unexpected SQL: ${request.sql}`);
  });
  assert.equal((await administration.listSecurityPrincipals(session))[0].grantee, "'app'@'%'");
  assert.equal((await administration.listSecurityPrivileges(session))[0].catalog, "nublox");
  assert.equal((await administration.listRoleMemberships(session))[0].defaultRole, true);
});

test("MySQL security previews quote accounts and mark destructive changes", () => {
  const administration = provider(async () => execution([]));
  const grant = administration.previewSecurityChange({ kind: "grant-privileges", grantee: "app@%", privileges: ["select", "update"], scope: "table", catalog: "nublox", table: "orders" });
  assert.equal(grant.destructive, false);
  assert.equal(grant.statements[0], "GRANT SELECT, UPDATE ON `nublox`.`orders` TO 'app'@'%'");
  const revoke = administration.previewSecurityChange({ kind: "revoke-role", role: "reader@%", grantee: "app@%" });
  assert.equal(revoke.destructive, true);
  assert.equal(revoke.statements[0], "REVOKE 'reader'@'%' FROM 'app'@'%'");
});

test("MySQL administration provider maps storage and bounded row movement", async () => {
  const calls = [];
  const administration = provider(async (_session, request) => {
    calls.push(request);
    if (request.sql.includes("INFORMATION_SCHEMA.TABLES")) return execution([{ catalogName: "nublox", tableName: "orders", engineName: "InnoDB", estimatedRows: "12", dataBytes: "1024", indexBytes: "256", freeBytes: "0" }]);
    if (request.sql.startsWith("SELECT *")) return execution([{ id: 1, status: "open" }]);
    if (request.sql.startsWith("INSERT INTO")) return execution([], { affectedRows: 1 });
    throw new Error(`Unexpected SQL: ${request.sql}`);
  });
  const storage = await administration.listStorage(session);
  assert.equal(storage[0].totalBytes, 1280);
  const rows = await administration.readTableRows(session, { catalog: "nublox", table: "orders", limit: 100 });
  assert.equal(rows.rows.length, 1);
  const write = await administration.writeTableRows(session, { catalog: "nublox", table: "orders", rows: [{ id: 2, status: "paid" }] });
  assert.deepEqual(write, { rowsAttempted: 1, rowsWritten: 1 });
  assert.equal(calls.at(-1).mode, "prepared");
});

test("MySQL backup and restore hooks keep passwords out of command arguments", () => {
  const administration = provider(async () => execution([]));
  const connection = { host: "localhost", port: 3306, user: "root" };
  const backup = administration.createBackupPlan(connection, "nublox");
  const restore = administration.createRestorePlan(connection, "nublox");
  assert.equal(backup.executable, "mysqldump");
  assert.equal(backup.passwordEnvironmentVariable, "MYSQL_PWD");
  assert.equal(backup.args.some((value) => value.includes("password")), false);
  assert.equal(restore.executable, "mysql");
  assert.equal(restore.destructive, true);
});

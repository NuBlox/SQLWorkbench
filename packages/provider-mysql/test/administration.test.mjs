import assert from "node:assert/strict";
import test from "node:test";

import { MySqlAdministrationProvider, mysqlAdministrationCapabilities } from "../dist/administration.js";

const session = { id: "session", providerId: "mysql", connectedAt: new Date(0).toISOString(), health: async () => ({ ok: true }), close: async () => {} };

function execution(rows) {
  return {
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(0).toISOString(),
    elapsedMs: 0,
    resultSets: [{ columns: [], rows }],
  };
}

test("MySQL administration provider advertises lock inspection", () => {
  assert.equal(mysqlAdministrationCapabilities.locks, true);
});

test("MySQL administration provider maps processlist rows", async () => {
  const provider = new MySqlAdministrationProvider({
    async execute(_session, request) {
      assert.match(request.sql, /INFORMATION_SCHEMA\.PROCESSLIST/u);
      return execution([
        { sessionId: 42, userName: "app", hostName: "localhost:53122", databaseName: "nublox", commandName: "Query", timeSeconds: 7, stateName: "executing", statementText: "SELECT 1" },
        { sessionId: 43, userName: "system user", hostName: null, databaseName: null, commandName: "Daemon", timeSeconds: "2", stateName: null, statementText: null },
      ]);
    },
  });

  const sessions = await provider.listSessions(session);
  assert.equal(sessions.length, 2);
  assert.deepEqual(sessions[0], {
    id: "42",
    user: "app",
    host: "localhost:53122",
    database: "nublox",
    command: "Query",
    timeSeconds: 7,
    state: "executing",
    statement: "SELECT 1",
  });
  assert.equal(sessions[1].id, "43");
  assert.equal(sessions[1].timeSeconds, 2);
  assert.equal(sessions[1].database, undefined);
});

test("MySQL administration provider maps blocking lock waits", async () => {
  const provider = new MySqlAdministrationProvider({
    async execute(_session, request) {
      assert.match(request.sql, /performance_schema\.data_lock_waits/u);
      assert.match(request.sql, /performance_schema\.data_locks/u);
      assert.match(request.sql, /INFORMATION_SCHEMA\.INNODB_TRX/u);
      return execution([
        {
          waitingSessionId: 51,
          blockingSessionId: 42,
          objectName: "nublox.orders",
          lockType: "RECORD",
          lockMode: "X,REC_NOT_GAP",
          waitSeconds: "12",
          statementText: "UPDATE orders SET status='paid' WHERE id=7",
        },
      ]);
    },
  });

  assert.deepEqual(await provider.listLockWaits(session), [{
    waitingSessionId: "51",
    blockingSessionId: "42",
    object: "nublox.orders",
    lockType: "RECORD",
    lockMode: "X,REC_NOT_GAP",
    waitSeconds: 12,
    statement: "UPDATE orders SET status='paid' WHERE id=7",
  }]);
});

test("MySQL administration provider maps and filters global variables/status", async () => {
  const provider = new MySqlAdministrationProvider({
    async execute(_session, request) {
      if (request.sql === "SHOW GLOBAL VARIABLES") return execution([
        { Variable_name: "max_connections", Value: "151" },
        { Variable_name: "sql_mode", Value: "STRICT_TRANS_TABLES" },
      ]);
      if (request.sql === "SHOW GLOBAL STATUS") return execution([
        { Variable_name: "Threads_connected", Value: "4" },
        { Variable_name: "Uptime", Value: "3600" },
      ]);
      throw new Error(`Unexpected SQL: ${request.sql}`);
    },
  });

  assert.deepEqual(await provider.listServerVariables(session, "connection"), [{ name: "max_connections", value: "151" }]);
  assert.deepEqual(await provider.listServerStatus(session, "thread"), [{ name: "Threads_connected", value: "4" }]);
});

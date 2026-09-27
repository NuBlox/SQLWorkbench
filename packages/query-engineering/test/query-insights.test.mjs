import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateQueryStatistics,
  fingerprintSql,
  normalizeSqlForFingerprint,
} from "../dist/query-insights.js";

test("normalizes insignificant whitespace without changing quoted values", () => {
  assert.equal(
    normalizeSqlForFingerprint("  SELECT   *\nFROM customers WHERE name = 'A  B';  "),
    "SELECT * FROM customers WHERE name = 'A  B'",
  );
  assert.equal(normalizeSqlForFingerprint("SELECT `Odd  Name` FROM t;"), "SELECT `Odd  Name` FROM t");
});

test("fingerprints equivalent whitespace consistently", () => {
  assert.equal(fingerprintSql("SELECT * FROM customers;"), fingerprintSql("SELECT   *\nFROM customers"));
  assert.notEqual(fingerprintSql("SELECT * FROM customers"), fingerprintSql("SELECT * FROM orders"));
});

test("aggregates query execution statistics and plan history", () => {
  const sql = "SELECT * FROM customers";
  const fingerprint = fingerprintSql(sql);
  const statistics = calculateQueryStatistics([
    { id: "1", sql, startedAt: "2026-09-27T20:00:00.000Z", elapsedMs: 10, status: "success", statementCount: 1, resultSetCount: 1 },
    { id: "2", sql: "SELECT  *  FROM customers;", startedAt: "2026-09-27T21:00:00.000Z", elapsedMs: 30, status: "success", statementCount: 1, resultSetCount: 1 },
    { id: "3", sql: "DELETE FROM missing", startedAt: "2026-09-27T22:00:00.000Z", elapsedMs: 20, status: "error", statementCount: 1, resultSetCount: 0 },
    { id: "4", sql: "SELECT SLEEP(10)", startedAt: "2026-09-27T22:10:00.000Z", elapsedMs: 40, status: "cancelled", statementCount: 1, resultSetCount: 0 },
  ], [
    { fingerprint, capturedAt: "2026-09-27T21:30:00.000Z", queryCost: 3.5, nodeCount: 4 },
  ]);

  assert.equal(statistics.summary.totalExecutions, 4);
  assert.equal(statistics.summary.successfulExecutions, 2);
  assert.equal(statistics.summary.failedExecutions, 1);
  assert.equal(statistics.summary.cancelledExecutions, 1);
  assert.equal(statistics.summary.successRate, 0.5);
  assert.equal(statistics.summary.averageElapsedMs, 25);
  assert.equal(statistics.summary.p95ElapsedMs, 40);
  assert.equal(statistics.summary.uniqueQueries, 3);
  assert.equal(statistics.summary.capturedPlans, 1);

  const customers = statistics.queries.find((query) => query.fingerprint === fingerprint);
  assert.ok(customers);
  assert.equal(customers.executions, 2);
  assert.equal(customers.averageElapsedMs, 20);
  assert.equal(customers.p95ElapsedMs, 30);
  assert.equal(customers.planCount, 1);
  assert.equal(customers.lastQueryCost, 3.5);
  assert.equal(customers.lastExecutedAt, "2026-09-27T21:00:00.000Z");
});

test("empty statistics produce zero-valued summary", () => {
  const statistics = calculateQueryStatistics([]);
  assert.equal(statistics.summary.totalExecutions, 0);
  assert.equal(statistics.summary.successRate, 0);
  assert.equal(statistics.summary.p95ElapsedMs, 0);
  assert.deepEqual(statistics.queries, []);
});

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { fingerprintSql, QueryPlanHistoryStore } from "../dist/electron/main/plan-history-store.js";
import { QueryHistoryStore } from "../dist/electron/main/query-history-store.js";
import { QueryStatisticsService } from "../dist/electron/main/query-statistics-service.js";

const plan = (cost, nodeCount) => ({
  providerId: "mysql",
  format: "mysql-json",
  nodeCount,
  queryCost: cost,
  root: {
    id: "root",
    kind: "query-block",
    label: "Query block",
    properties: [],
    children: [],
  },
});

test("plan history persists normalized snapshots and query statistics aggregate execution and plan history", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nublox-plan-history-"));
  try {
    const queryHistory = new QueryHistoryStore(join(directory, "query-history.json"));
    const planHistory = new QueryPlanHistoryStore(join(directory, "plan-history.json"));
    const statistics = new QueryStatisticsService(queryHistory, planHistory);
    const sql = "SELECT * FROM orders;";

    await queryHistory.add({
      id: "run-1",
      connectionId: "profile-a",
      mode: "statement",
      sql,
      startedAt: "2026-09-27T20:00:00.000Z",
      elapsedMs: 10,
      status: "success",
      statementCount: 1,
      resultSetCount: 1,
    });
    await queryHistory.add({
      id: "run-2",
      connectionId: "profile-a",
      mode: "statement",
      sql,
      startedAt: "2026-09-27T20:01:00.000Z",
      elapsedMs: 30,
      status: "error",
      statementCount: 0,
      resultSetCount: 0,
      message: "test error",
    });
    await queryHistory.add({
      id: "other-connection",
      connectionId: "profile-b",
      mode: "statement",
      sql,
      startedAt: "2026-09-27T20:02:00.000Z",
      elapsedMs: 999,
      status: "success",
      statementCount: 1,
      resultSetCount: 1,
    });

    const firstPlan = await planHistory.add({
      connectionId: "profile-a",
      sql,
      capturedAt: "2026-09-27T20:03:00.000Z",
      explainElapsedMs: 8,
      plan: plan(20, 3),
    });
    const secondPlan = await planHistory.add({
      connectionId: "profile-a",
      sql,
      capturedAt: "2026-09-27T20:04:00.000Z",
      explainElapsedMs: 6,
      plan: plan(15, 4),
    });

    const persisted = await planHistory.list(10);
    assert.equal(persisted.length, 2);
    assert.equal(persisted[0].id, secondPlan.id);
    assert.equal(persisted[1].id, firstPlan.id);
    assert.equal(persisted[0].sqlFingerprint, fingerprintSql(sql));

    assert.deepEqual(await statistics.forQuery("profile-a", sql), {
      connectionId: "profile-a",
      sqlFingerprint: fingerprintSql(sql),
      executionCount: 2,
      successCount: 1,
      errorCount: 1,
      cancelledCount: 0,
      averageElapsedMs: 20,
      minimumElapsedMs: 10,
      maximumElapsedMs: 30,
      lastExecutedAt: "2026-09-27T20:01:00.000Z",
      explainCount: 2,
      lastExplainedAt: "2026-09-27T20:04:00.000Z",
      latestExplainElapsedMs: 6,
      latestPlanNodeCount: 4,
      latestPlanCost: 15,
      previousPlanCost: 20,
      planCostDelta: -5,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("SQL fingerprints do not collapse semantically significant literal whitespace", () => {
  assert.notEqual(fingerprintSql("SELECT 'a  b';"), fingerprintSql("SELECT 'a b';"));
  assert.equal(fingerprintSql(" SELECT 1;;;  "), fingerprintSql("SELECT 1"));
});

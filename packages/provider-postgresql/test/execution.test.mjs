import assert from "node:assert/strict";
import test from "node:test";

import {
  executePostgreSqlRequest,
  normalizeTimeoutMs,
} from "../dist/execution.js";

function successfulResult(rows = [{ value: 1 }]) {
  return {
    command: "SELECT",
    rowCount: rows.length,
    rows,
    fields: [{ name: "value", dataTypeID: 23 }],
  };
}

function createHarness() {
  let releaseCount = 0;
  let cancelCalls = 0;
  let rejectActiveQuery;
  let queryStartedResolve;
  const queryStarted = new Promise((resolve) => { queryStartedResolve = resolve; });

  const client = {
    processID: 4242,
    query() {
      queryStartedResolve();
      return new Promise((resolve, reject) => {
        rejectActiveQuery = reject;
      });
    },
    release() { releaseCount += 1; },
  };

  const queryPool = {
    async connect() { return client; },
  };

  const controlPool = {
    async query(sql, values) {
      cancelCalls += 1;
      assert.equal(sql, "SELECT pg_cancel_backend($1) AS cancelled");
      assert.deepEqual(values, [4242]);
      rejectActiveQuery?.(Object.assign(new Error("canceling statement due to user request"), { code: "57014" }));
      return { rows: [{ cancelled: true }] };
    },
  };

  return {
    client,
    queryPool,
    controlPool,
    queryStarted,
    get releaseCount() { return releaseCount; },
    get cancelCalls() { return cancelCalls; },
  };
}

test("normalizes positive PostgreSQL query timeouts", () => {
  assert.equal(normalizeTimeoutMs(undefined), undefined);
  assert.equal(normalizeTimeoutMs(10), 10);
  assert.equal(normalizeTimeoutMs(10.2), 11);
  assert.throws(() => normalizeTimeoutMs(0), /positive finite number/);
  assert.throws(() => normalizeTimeoutMs(Number.POSITIVE_INFINITY), /positive finite number/);
});

test("rejects a request whose AbortSignal is already aborted without acquiring a client", async () => {
  const controller = new AbortController();
  controller.abort("cancelled-before-start");
  let connects = 0;

  await assert.rejects(
    executePostgreSqlRequest(
      { async connect() { connects += 1; throw new Error("should not connect"); } },
      { async query() { throw new Error("should not cancel"); } },
      { sql: "SELECT pg_sleep(10)", signal: controller.signal },
    ),
    /query was cancelled/,
  );

  assert.equal(connects, 0);
});

test("AbortSignal cancellation dispatches pg_cancel_backend and releases the query client", async () => {
  const harness = createHarness();
  const controller = new AbortController();

  const execution = executePostgreSqlRequest(
    harness.queryPool,
    harness.controlPool,
    { sql: "SELECT pg_sleep(30)", signal: controller.signal },
  );

  await harness.queryStarted;
  controller.abort("user-request");

  await assert.rejects(execution, /PostgreSQL query was cancelled/);
  assert.equal(harness.cancelCalls, 1);
  assert.equal(harness.releaseCount, 1);
});

test("timeout cancellation dispatches pg_cancel_backend and reports the configured deadline", async () => {
  const harness = createHarness();

  const execution = executePostgreSqlRequest(
    harness.queryPool,
    harness.controlPool,
    { sql: "SELECT pg_sleep(30)", timeoutMs: 5 },
  );

  await harness.queryStarted;
  await assert.rejects(execution, /PostgreSQL query timed out after 5 ms/);
  assert.equal(harness.cancelCalls, 1);
  assert.equal(harness.releaseCount, 1);
});

test("successful execution normalizes result metadata and releases the client", async () => {
  let releaseCount = 0;
  const queryPool = {
    async connect() {
      return {
        processID: 9,
        async query(config) {
          assert.equal(config.text, "SELECT $1::int AS value");
          assert.deepEqual(config.values, [7]);
          return successfulResult([{ value: 7 }]);
        },
        release() { releaseCount += 1; },
      };
    },
  };

  const result = await executePostgreSqlRequest(
    queryPool,
    { async query() { throw new Error("cancellation should not run"); } },
    { sql: "SELECT $1::int AS value", values: [7] },
  );

  assert.equal(result.resultSets.length, 1);
  assert.deepEqual(result.resultSets[0].rows, [{ value: 7 }]);
  assert.equal(result.resultSets[0].columns[0].name, "value");
  assert.equal(result.resultSets[0].columns[0].databaseType, "23");
  assert.equal(releaseCount, 1);
});

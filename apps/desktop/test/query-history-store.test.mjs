import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { QueryHistoryStore } from "../dist/electron/main/query-history-store.js";

test("query history is bounded, newest-first and persisted with restrictive permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nublox-history-"));
  const file = join(directory, "history.json");
  const store = new QueryHistoryStore(file, 2);

  const base = {
    connectionId: "local",
    mode: "statement",
    sql: "SELECT 1",
    startedAt: new Date(0).toISOString(),
    elapsedMs: 5,
    status: "success",
    statementCount: 1,
    resultSetCount: 1,
  };

  await store.add({ id: "1", ...base });
  await store.add({ id: "2", ...base, sql: "SELECT 2" });
  await store.add({ id: "3", ...base, sql: "SELECT 3" });

  assert.deepEqual((await store.list()).map((entry) => entry.id), ["3", "2"]);
  assert.match(await readFile(file, "utf8"), /SELECT 3/);
  if (process.platform !== "win32") {
    assert.equal((await stat(file)).mode & 0o777, 0o600);
  }

  await store.clear();
  assert.deepEqual(await store.list(), []);
  await rm(directory, { recursive: true, force: true });
});

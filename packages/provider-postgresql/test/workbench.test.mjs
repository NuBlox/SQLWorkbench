import assert from "node:assert/strict";
import test from "node:test";

import { PostgreSqlDatabaseProvider, postgresqlCapabilities } from "../dist/workbench.js";

function fakeSession(providerId = "postgresql") {
  return {
    id: "test-session",
    providerId,
    connectedAt: new Date(0).toISOString(),
    async health() { return { ok: true }; },
    async close() {},
  };
}

test("parity provider advertises implemented PostgreSQL catalog capabilities", () => {
  const provider = new PostgreSqlDatabaseProvider();
  assert.equal(provider.id, "postgresql");
  assert.equal(provider.displayName, "PostgreSQL");
  assert.equal(postgresqlCapabilities.procedures, true);
  assert.equal(postgresqlCapabilities.functions, true);
  assert.equal(postgresqlCapabilities.triggers, true);
  assert.equal(postgresqlCapabilities.objectSearch, true);
  assert.equal(postgresqlCapabilities.privilegeIntrospection, true);
  assert.ok(provider.explorer);
});

test("blank PostgreSQL object search short-circuits without a database query", async () => {
  const provider = new PostgreSqlDatabaseProvider();
  const results = await provider.explorer.search(fakeSession(), { term: "   " });
  assert.deepEqual(results, []);
});

test("catalog-security explorer rejects a non-PostgreSQL session before querying", async () => {
  const provider = new PostgreSqlDatabaseProvider();
  await assert.rejects(
    provider.explorer.listPrincipals(fakeSession("mysql")),
    /PostgreSQL explorer cannot use provider 'mysql'/,
  );
});

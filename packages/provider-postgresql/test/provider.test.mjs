import assert from "node:assert/strict";
import test from "node:test";

import { PostgreSqlDatabaseProvider, postgresqlCapabilities } from "../dist/index.js";

test("quotes PostgreSQL identifiers and escapes embedded double quotes", () => {
  const provider = new PostgreSqlDatabaseProvider();
  assert.equal(provider.quoteIdentifier('order"line'), '"order""line"');
});

test("declares PostgreSQL provider identity and foundation capabilities", () => {
  const provider = new PostgreSqlDatabaseProvider();
  assert.equal(provider.id, "postgresql");
  assert.equal(provider.displayName, "PostgreSQL");
  assert.equal(postgresqlCapabilities.catalogIntrospection, true);
  assert.equal(postgresqlCapabilities.schemas, true);
  assert.equal(postgresqlCapabilities.explainPlan, true);
  assert.equal(postgresqlCapabilities.queryCancellation, false);
});

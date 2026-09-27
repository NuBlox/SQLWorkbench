import assert from "node:assert/strict";
import test from "node:test";

import { MySqlDatabaseProvider } from "../dist/index.js";

test("quotes MySQL identifiers and escapes embedded backticks", () => {
  const provider = new MySqlDatabaseProvider();
  assert.equal(provider.quoteIdentifier("order`line"), "`order``line`");
});

test("declares the M2 explorer capability surface", () => {
  const provider = new MySqlDatabaseProvider();
  assert.equal(provider.capabilities.catalogIntrospection, true);
  assert.equal(provider.capabilities.queryCancellation, true);
  assert.equal(provider.capabilities.explainPlan, true);
  assert.equal(provider.capabilities.procedures, true);
  assert.equal(provider.capabilities.functions, true);
  assert.equal(provider.capabilities.triggers, true);
  assert.equal(provider.capabilities.events, true);
  assert.equal(provider.capabilities.objectSearch, true);
  assert.equal(provider.capabilities.privilegeIntrospection, true);
  assert.ok(provider.explorer);
});

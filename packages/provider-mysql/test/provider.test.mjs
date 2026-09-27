import assert from "node:assert/strict";
import test from "node:test";

import { MySqlDatabaseProvider } from "../dist/index.js";

test("quotes MySQL identifiers and escapes embedded backticks", () => {
  const provider = new MySqlDatabaseProvider();
  assert.equal(provider.quoteIdentifier("order`line"), "`order``line`");
});

test("declares the implemented initial capability surface", () => {
  const provider = new MySqlDatabaseProvider();
  assert.equal(provider.capabilities.catalogIntrospection, true);
  assert.equal(provider.capabilities.queryCancellation, true);
  assert.equal(provider.capabilities.explainPlan, true);
  assert.equal(provider.capabilities.procedures, false);
});

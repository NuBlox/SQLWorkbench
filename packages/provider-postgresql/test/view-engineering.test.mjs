import assert from "node:assert/strict";
import test from "node:test";

import { PostgreSqlViewEngineeringProvider } from "../dist/view-engineering.js";

function host(rows = []) {
  return {
    quoteIdentifier(identifier) { return `"${identifier.replaceAll('"', '""')}"`; },
    async execute(_session, request) {
      assert.match(request.sql, /pg_get_viewdef/);
      assert.deepEqual(request.values, ["reporting", "active_orders"]);
      return {
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(0).toISOString(),
        elapsedMs: 0,
        resultSets: [{ columns: [], rows }],
      };
    },
  };
}

const session = {
  id: "session",
  providerId: "postgresql",
  connectedAt: new Date(0).toISOString(),
  async health() { return { ok: true }; },
  async close() {},
};

test("loads PostgreSQL view metadata including security invoker and check option", async () => {
  const provider = new PostgreSqlViewEngineeringProvider(host([{
    definition: " SELECT * FROM orders WHERE active ",
    checkOption: "LOCAL",
    isUpdatable: "YES",
    owner: "app_owner",
    securityInvoker: true,
  }]));

  const result = await provider.load(session, { schema: "reporting", name: "active_orders" });
  assert.equal(result.schema, "reporting");
  assert.equal(result.name, "active_orders");
  assert.equal(result.selectSql, "SELECT * FROM orders WHERE active");
  assert.equal(result.algorithm, "undefined");
  assert.equal(result.definer, "app_owner");
  assert.equal(result.securityType, "invoker");
  assert.equal(result.checkOption, "local");
  assert.equal(result.updatable, true);
});

test("previews CREATE OR REPLACE VIEW with PostgreSQL security invoker and check option", () => {
  const provider = new PostgreSqlViewEngineeringProvider(host());
  const preview = provider.preview({
    schema: "reporting",
    name: "active_orders",
    selectSql: "SELECT * FROM orders WHERE active;",
    algorithm: "undefined",
    securityType: "invoker",
    checkOption: "cascaded",
  });

  assert.deepEqual(preview.statements, [
    'CREATE OR REPLACE VIEW "reporting"."active_orders" WITH (security_invoker = true) AS SELECT * FROM orders WHERE active WITH CASCADED CHECK OPTION;',
  ]);
  assert.deepEqual(preview.warnings, []);
});

test("warns and ignores MySQL-specific view algorithms", () => {
  const provider = new PostgreSqlViewEngineeringProvider(host());
  const preview = provider.preview({
    schema: "reporting",
    name: "active_orders",
    selectSql: "SELECT 1",
    algorithm: "temptable",
    securityType: "definer",
    checkOption: "none",
  });

  assert.equal(preview.statements[0], 'CREATE OR REPLACE VIEW "reporting"."active_orders" AS SELECT 1;');
  assert.match(preview.warnings[0], /temptable/);
});

test("rejects unsafe non-query view definitions", () => {
  const provider = new PostgreSqlViewEngineeringProvider(host());
  assert.throws(() => provider.preview({
    schema: "reporting",
    name: "active_orders",
    selectSql: "DROP TABLE orders",
    algorithm: "undefined",
    securityType: "definer",
    checkOption: "none",
  }), /must begin with SELECT, WITH, TABLE or VALUES/);
});

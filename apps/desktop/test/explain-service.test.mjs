import assert from "node:assert/strict";
import test from "node:test";

import { ConnectionManager, ProviderRegistry } from "@nublox/workbench-core";

import { DesktopExplainService } from "../dist/electron/main/explain-service.js";

function provider(explainPlan = true) {
  return {
    id: "mysql",
    displayName: "MySQL Test",
    capabilities: {
      catalogIntrospection: false,
      schemas: false,
      views: false,
      indexes: false,
      foreignKeys: false,
      procedures: false,
      functions: false,
      triggers: false,
      partitions: false,
      transactions: true,
      savepoints: false,
      explainPlan,
      queryCancellation: false,
      serverAdministration: false,
      userAdministration: false,
    },
    async connect() {
      return {
        id: "session",
        providerId: "mysql",
        connectedAt: new Date(0).toISOString(),
        async health() { return { ok: true }; },
        async close() {},
      };
    },
    async introspect() { throw new Error("not used"); },
    async execute() { throw new Error("not used"); },
    async explain(_session, request) {
      assert.equal(request.sql, "SELECT * FROM customers");
      return {
        format: "mysql-json",
        raw: [{
          rows: [{
            EXPLAIN: JSON.stringify({
              query_block: {
                select_id: 1,
                cost_info: { query_cost: "2.50" },
                table: {
                  table_name: "customers",
                  access_type: "ALL",
                  rows_examined_per_scan: 25,
                  cost_info: { prefix_cost: "2.50" },
                },
              },
            }),
          }],
        }],
      };
    },
    quoteIdentifier(value) { return `\`${value}\``; },
  };
}

async function connectedManager(explainPlan = true) {
  const registry = new ProviderRegistry();
  registry.register(provider(explainPlan));
  const connections = new ConnectionManager(registry);
  await connections.connect("dev", { providerId: "mysql", host: "localhost", user: "test" });
  return connections;
}

test("desktop explain service normalizes provider plans", async () => {
  const connections = await connectedManager();
  const service = new DesktopExplainService(connections);
  const plan = await service.explain({ connectionId: "dev", sql: "SELECT * FROM customers" });
  assert.equal(plan.providerId, "mysql");
  assert.equal(plan.queryCost, 2.5);
  assert.equal(plan.root.children[0].label, "customers");
  assert.equal(plan.root.children[0].estimatedRows, 25);
  await connections.disconnectAll();
});

test("desktop explain service rejects providers without explain capability", async () => {
  const connections = await connectedManager(false);
  const service = new DesktopExplainService(connections);
  await assert.rejects(
    service.explain({ connectionId: "dev", sql: "SELECT * FROM customers" }),
    /does not support explain plans/u,
  );
  await connections.disconnectAll();
});

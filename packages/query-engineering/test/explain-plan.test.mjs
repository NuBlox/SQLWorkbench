import assert from "node:assert/strict";
import test from "node:test";

import { normalizeExplainPlan } from "../dist/explain-plan.js";

const mysqlPayload = {
  query_block: {
    select_id: 1,
    cost_info: { query_cost: "5.75" },
    nested_loop: [
      {
        table: {
          table_name: "customers",
          access_type: "ALL",
          rows_examined_per_scan: 100,
          rows_produced_per_join: 10,
          filtered: "10.00",
          cost_info: { read_cost: "2.25", eval_cost: "1.00", prefix_cost: "3.25", data_read_per_join: "16K" },
        },
      },
      {
        table: {
          table_name: "orders",
          access_type: "ref",
          key: "idx_orders_customer",
          rows_examined_per_scan: 4,
          rows_produced_per_join: 40,
          filtered: "100.00",
          cost_info: { read_cost: "1.25", eval_cost: "0.40", prefix_cost: "5.75" },
        },
      },
    ],
  },
};

test("normalizes MySQL FORMAT=JSON provider result sets into a plan tree", () => {
  const raw = [{ columns: [{ name: "EXPLAIN" }], rows: [{ EXPLAIN: JSON.stringify(mysqlPayload) }] }];
  const plan = normalizeExplainPlan("mysql", "mysql-json", raw);

  assert.equal(plan.providerId, "mysql");
  assert.equal(plan.root.kind, "query");
  assert.equal(plan.root.label, "Query block #1");
  assert.equal(plan.queryCost, 5.75);
  assert.equal(plan.nodeCount, 4);
  assert.equal(plan.root.children[0].kind, "join");
  assert.equal(plan.root.children[0].children[0].label, "customers");
  assert.equal(plan.root.children[0].children[1].keyUsed, "idx_orders_customer");
});

test("accepts an already parsed MySQL JSON explain payload", () => {
  const plan = normalizeExplainPlan("mysql", "mysql-json", mysqlPayload);
  assert.equal(plan.root.children[0].children[1].accessType, "ref");
  assert.equal(plan.root.children[0].children[1].estimatedRows, 40);
});

test("rejects unsupported or malformed explain payloads", () => {
  assert.throws(() => normalizeExplainPlan("postgres", "postgres-json", {}), /not supported/u);
  assert.throws(() => normalizeExplainPlan("mysql", "mysql-json", [{ rows: [] }]), /JSON payload/u);
});

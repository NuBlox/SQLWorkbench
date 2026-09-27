import assert from "node:assert/strict";
import test from "node:test";

import {
  renderVisualQuery,
  validateVisualQuery,
  visualQueryRelations,
  visualSourceFromRelation,
} from "../dist/visual-query.js";

const catalog = {
  providerId: "mysql",
  capturedAt: "2026-09-27T22:00:00.000Z",
  namespaces: [{
    catalog: "sales",
    label: "sales",
    relations: [
      {
        catalog: "sales",
        name: "customers",
        kind: "table",
        columns: [
          { name: "id", databaseType: "int" },
          { name: "status", databaseType: "varchar(20)" },
          { name: "name", databaseType: "varchar(100)" },
        ],
      },
      {
        catalog: "sales",
        name: "orders",
        kind: "table",
        columns: [
          { name: "id", databaseType: "int" },
          { name: "customer_id", databaseType: "int" },
          { name: "total", databaseType: "decimal(12,2)" },
        ],
      },
    ],
  }],
};

function relation(name) {
  const item = visualQueryRelations(catalog).find((candidate) => candidate.name === name);
  assert.ok(item);
  return item;
}

test("renders a catalogue-validated joined aggregate query", () => {
  const customers = visualSourceFromRelation("base", relation("customers"), "c");
  const orders = visualSourceFromRelation("orders", relation("orders"), "o");
  const model = {
    distinct: false,
    from: customers,
    projections: [
      { id: "p1", sourceId: "base", column: "id", aggregate: "none" },
      { id: "p2", sourceId: "orders", column: "id", aggregate: "count", alias: "order_count" },
    ],
    joins: [{
      id: "j1",
      type: "left",
      source: orders,
      left: { sourceId: "base", column: "id" },
      right: { sourceId: "orders", column: "customer_id" },
    }],
    filters: [{
      id: "f1",
      conjunction: "and",
      sourceId: "base",
      column: "status",
      operator: "=",
      value: { kind: "text", value: "active" },
    }],
    groupBy: [{ id: "g1", sourceId: "base", column: "id" }],
    orderBy: [{ id: "o1", sourceId: "base", column: "id", direction: "desc" }],
    limit: 50,
  };

  const sql = renderVisualQuery(model, catalog);
  assert.match(sql, /SELECT\n  `c`\.`id`,\n  COUNT\(`o`\.`id`\) AS `order_count`/u);
  assert.match(sql, /FROM `sales`\.`customers` AS `c`/u);
  assert.match(sql, /LEFT JOIN `sales`\.`orders` AS `o`\n  ON `c`\.`id` = `o`\.`customer_id`/u);
  assert.match(sql, /WHERE `c`\.`status` = 'active'/u);
  assert.match(sql, /GROUP BY\n  `c`\.`id`/u);
  assert.match(sql, /ORDER BY\n  `c`\.`id` DESC/u);
  assert.match(sql, /LIMIT 50;/u);
});

test("escapes text literals and supports null predicates", () => {
  const customers = visualSourceFromRelation("base", relation("customers"), "c");
  const model = {
    distinct: true,
    from: customers,
    projections: [{ id: "p1", sourceId: "base", column: "name" }],
    joins: [],
    filters: [
      { id: "f1", conjunction: "and", sourceId: "base", column: "name", operator: "=", value: { kind: "text", value: "O'Reilly" } },
      { id: "f2", conjunction: "or", sourceId: "base", column: "status", operator: "is-null" },
    ],
    groupBy: [],
    orderBy: [],
  };
  const sql = renderVisualQuery(model, catalog);
  assert.match(sql, /SELECT DISTINCT/u);
  assert.match(sql, /'O''Reilly'/u);
  assert.match(sql, /OR `c`\.`status` IS NULL/u);
});

test("validation rejects unknown columns, ambiguous aliases and invalid limits", () => {
  const customers = visualSourceFromRelation("base", relation("customers"), "x");
  const orders = visualSourceFromRelation("orders", relation("orders"), "x");
  const validation = validateVisualQuery({
    distinct: false,
    from: customers,
    projections: [{ id: "p1", sourceId: "base", column: "missing" }],
    joins: [{ id: "j1", type: "cross", source: orders }],
    filters: [],
    groupBy: [],
    orderBy: [],
    limit: 0,
  }, catalog);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => /ambiguous/u.test(error)));
  assert.ok(validation.errors.some((error) => /missing/u.test(error)));
  assert.ok(validation.errors.some((error) => /LIMIT/u.test(error)));
});

test("relation options preserve namespace and relation kinds", () => {
  const options = visualQueryRelations(catalog);
  assert.deepEqual(options.map((item) => [item.namespaceLabel, item.name, item.kind]), [
    ["sales", "customers", "table"],
    ["sales", "orders", "table"],
  ]);
});

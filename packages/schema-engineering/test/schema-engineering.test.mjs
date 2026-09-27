import assert from "node:assert/strict";
import test from "node:test";

import {
  createSchemaDraft,
  dependencyGraph,
  previewSchemaDraft,
} from "../dist/index.js";

const orders = {
  catalog: "sales",
  name: "orders",
  kind: "table",
  columns: [
    column("id", 1, "int", "int", false, { autoIncrement: true }),
    column("customer_id", 2, "int", "int", false),
    column("total", 3, "decimal", "decimal(12,2)", false),
  ],
  indexes: [
    index("PRIMARY", true, true, ["id"]),
    index("ix_customer", false, false, ["customer_id"]),
  ],
  foreignKeys: [
    {
      name: "fk_orders_customer",
      columns: ["customer_id"],
      referencedCatalog: "sales",
      referencedTable: "customers",
      referencedColumns: ["id"],
      deleteRule: "RESTRICT",
    },
  ],
};

const customers = {
  catalog: "sales",
  name: "customers",
  kind: "table",
  columns: [column("id", 1, "int", "int", false, { autoIncrement: true })],
  indexes: [index("PRIMARY", true, true, ["id"])],
  foreignKeys: [],
};

test("creates an editable schema view from a live table", () => {
  const draft = createSchemaDraft(orders);
  assert.equal(draft.logicalName, "Orders");
  assert.equal(draft.attributes[1].name, "customerId");
  assert.equal(draft.attributes[2].databaseType, "decimal(12,2)");
  assert.equal(draft.relationships[0].physicalForeignKey, "fk_orders_customer");
  assert.deepEqual(draft.primaryKey, ["id"]);
});

test("rebuilds a live baseline and previews logical edits through a provider", () => {
  const input = createSchemaDraft(orders);
  const edited = {
    ...input,
    attributes: [
      ...input.attributes.map((attribute) => attribute.name === "total"
        ? { ...attribute, nullable: true, required: false }
        : attribute),
      {
        name: "status",
        physicalColumn: "order_status",
        type: "string",
        databaseType: "varchar(30)",
        required: true,
        nullable: false,
        readOnly: false,
        unique: false,
      },
    ],
  };
  const provider = {
    providerId: "test",
    preview(plan) {
      return {
        providerId: "test",
        statements: plan.operations.map((operation) => operation.kind),
        destructive: plan.destructive,
        warnings: [],
      };
    },
  };

  const preview = previewSchemaDraft(orders, edited, provider);
  assert.ok(preview.differences.some((difference) => difference.kind === "nullability-mismatch"));
  assert.ok(preview.differences.some((difference) => difference.kind === "missing-physical-column"));
  assert.ok(preview.providerPlan.operations.some((operation) => operation.kind === "add-column" && operation.databaseType === "varchar(30)"));
  assert.deepEqual(preview.providerPreview.statements.sort(), ["add-column", "alter-column"]);
});

test("omitting a physical column from the draft creates a destructive plan", () => {
  const input = createSchemaDraft(orders);
  const edited = { ...input, attributes: input.attributes.filter((attribute) => attribute.name !== "total") };
  const preview = previewSchemaDraft(orders, edited, {
    providerId: "test",
    preview(plan) { return { providerId: "test", statements: [], destructive: plan.destructive, warnings: [] }; },
  });
  assert.equal(preview.neutralPlan.destructive, true);
  assert.ok(preview.neutralPlan.operations.some((operation) => operation.kind === "drop-column" && operation.column === "total"));
});

test("builds an ER dependency graph and retains external references", () => {
  const graph = dependencyGraph([orders, customers]);
  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.edges[0].relationship, "fk_orders_customer");
  assert.equal(graph.nodes.find((node) => node.label === "sales.customers")?.external, false);

  const external = dependencyGraph([orders]);
  assert.equal(external.nodes.length, 2);
  assert.equal(external.nodes.find((node) => node.label === "sales.customers")?.external, true);
});

function column(name, ordinal, dataType, databaseType, nullable, extra = {}) {
  return { name, ordinal, dataType, databaseType, nullable, autoIncrement: false, generated: false, ...extra };
}
function index(name, primary, unique, columns) {
  return { name, primary, unique, columns: columns.map((columnName, offset) => ({ name: columnName, sequence: offset + 1 })) };
}

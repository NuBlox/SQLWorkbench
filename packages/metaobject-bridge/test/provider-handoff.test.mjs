import assert from "node:assert/strict";
import test from "node:test";

import { generateSchemaChangePlan, reverseEngineerTable } from "../dist/index.js";
import { previewWithProvider, toProviderMigrationPlan } from "../dist/provider-handoff.js";

const table = {
  catalog: "sales",
  name: "orders",
  kind: "table",
  columns: [
    { name: "id", ordinal: 1, dataType: "int", databaseType: "int", nullable: false, autoIncrement: true, generated: false },
  ],
  indexes: [{ name: "PRIMARY", primary: true, unique: true, columns: [{ name: "id", sequence: 1 }] }],
  foreignKeys: [],
};

test("enriches provider migration plans with retained physical database types", () => {
  const draft = reverseEngineerTable(table);
  const evolved = {
    ...draft,
    objectType: {
      ...draft.objectType,
      attributes: {
        ...draft.objectType.attributes,
        status: { type: "string", required: true, nullable: false },
      },
    },
    physical: {
      ...draft.physical,
      attributes: {
        ...draft.physical.attributes,
        status: {
          attribute: "status",
          column: "order_status",
          ordinal: 2,
          dataType: "varchar",
          databaseType: "varchar(30)",
          nullable: false,
          autoIncrement: false,
          generated: false,
        },
      },
    },
  };
  const plan = generateSchemaChangePlan(table, evolved);
  const providerPlan = toProviderMigrationPlan(plan, evolved);
  const operation = providerPlan.operations.find((item) => item.kind === "add-column");

  assert.ok(operation);
  assert.equal(operation.databaseType, "varchar(30)");
});

test("feeds the enriched neutral plan to a provider migration adapter", () => {
  const draft = reverseEngineerTable(table);
  const plan = generateSchemaChangePlan(table, draft);
  let received;
  const provider = {
    providerId: "test",
    preview(value) {
      received = value;
      return { providerId: "test", statements: ["-- preview"], destructive: value.destructive, warnings: [] };
    },
  };

  const preview = previewWithProvider(plan, draft, provider);
  assert.equal(received.source, "metaobject");
  assert.equal(received.table, "orders");
  assert.deepEqual(preview.statements, ["-- preview"]);
});

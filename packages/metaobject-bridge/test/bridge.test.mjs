import assert from "node:assert/strict";
import test from "node:test";

import {
  compareTableToMetaobject,
  generateSchemaChangePlan,
  logicalTypeForColumn,
  reverseEngineerTable,
} from "../dist/index.js";

const customers = {
  catalog: "sales_db",
  name: "customers",
  kind: "table",
  columns: [
    column("customer_id", 1, "bigint", "bigint unsigned", false, { autoIncrement: true }),
    column("display_name", 2, "varchar", "varchar(160)", false),
    column("email_address", 3, "varchar", "varchar(255)", true),
  ],
  indexes: [
    index("PRIMARY", true, true, ["customer_id"]),
    index("uq_customer_email", false, true, ["email_address"]),
  ],
  foreignKeys: [],
};

const orders = {
  catalog: "sales_db",
  name: "sales_orders",
  kind: "table",
  columns: [
    column("order_id", 1, "bigint", "bigint unsigned", false, { autoIncrement: true }),
    column("customer_id", 2, "bigint", "bigint unsigned", false),
    column("order_total", 3, "decimal", "decimal(12,2)", false),
    column("created_at", 4, "timestamp", "timestamp", false),
    column("payload", 5, "json", "json", true),
  ],
  indexes: [
    index("PRIMARY", true, true, ["order_id"]),
    index("ix_orders_customer", false, false, ["customer_id"]),
  ],
  foreignKeys: [
    {
      name: "fk_orders_customer",
      columns: ["customer_id"],
      referencedCatalog: "sales_db",
      referencedTable: "customers",
      referencedColumns: ["customer_id"],
      updateRule: "RESTRICT",
      deleteRule: "CASCADE",
    },
  ],
};

test("reverse engineers physical columns to native metaobject attributes and preserves names", () => {
  const draft = reverseEngineerTable(orders);

  assert.equal(draft.objectType.id, "db:sales_db.sales_orders");
  assert.equal(draft.objectType.name, "SalesOrders");
  assert.equal(draft.objectType.namespace, "sales_db");
  assert.equal(draft.objectType.attributes.orderId.type, "string");
  assert.equal(draft.objectType.attributes.orderId.readOnly, true);
  assert.equal(draft.objectType.attributes.orderTotal.type, "decimal");
  assert.equal(draft.objectType.attributes.createdAt.type, "datetime");
  assert.equal(draft.objectType.attributes.payload.type, "json");
  assert.equal(draft.physical.attributes.orderTotal.column, "order_total");
  assert.equal(draft.physical.attributes.orderTotal.databaseType, "decimal(12,2)");
  assert.deepEqual(draft.physical.primaryKey, ["order_id"]);
});

test("maps foreign keys to relationships with cardinality and referential semantics", () => {
  const draft = reverseEngineerTable(orders);
  const relationship = draft.objectType.relationships?.ordersCustomer;

  assert.ok(relationship);
  assert.equal(relationship.target, "db:sales_db.customers");
  assert.equal(relationship.cardinality, "many-to-one");
  assert.equal(relationship.required, true);
  assert.equal(relationship.onTargetDelete, "cascade");
  assert.equal(draft.physical.relationships.ordersCustomer.foreignKey, "fk_orders_customer");
  assert.deepEqual(draft.physical.relationships.ordersCustomer.columns, ["customer_id"]);
});

test("maps single-column unique indexes and preserves physical index names", () => {
  const draft = reverseEngineerTable(customers);

  assert.equal(draft.objectType.attributes.emailAddress.unique, true);
  assert.deepEqual(draft.objectType.indexes, [
    {
      name: "uq_customer_email",
      unique: true,
      attributes: [{ attribute: "emailAddress" }],
    },
  ]);
  assert.equal(draft.physical.indexes[1].physicalName, "uq_customer_email");
});

test("detects physical/logical drift and produces a database-neutral reconciliation plan", () => {
  const original = reverseEngineerTable(orders);
  const logical = {
    ...original,
    objectType: {
      ...original.objectType,
      attributes: {
        ...original.objectType.attributes,
        orderTotal: {
          ...original.objectType.attributes.orderTotal,
          nullable: true,
        },
        status: {
          type: "string",
          nullable: false,
          required: true,
        },
      },
    },
    physical: {
      ...original.physical,
      attributes: {
        ...original.physical.attributes,
        status: {
          attribute: "status",
          column: "order_status",
          ordinal: 6,
          dataType: "varchar",
          databaseType: "varchar(30)",
          nullable: false,
          autoIncrement: false,
          generated: false,
        },
      },
    },
  };

  const differences = compareTableToMetaobject(orders, logical);
  assert.ok(differences.some((item) => item.kind === "nullability-mismatch" && item.path === "attributes.orderTotal.nullable"));
  assert.ok(differences.some((item) => item.kind === "missing-physical-column" && item.path === "attributes.status"));

  const plan = generateSchemaChangePlan(orders, logical);
  assert.ok(plan.operations.some((operation) => operation.kind === "add-column" && operation.column === "order_status"));
  assert.ok(plan.operations.some((operation) => operation.kind === "alter-column" && operation.column === "order_total"));
  assert.equal(plan.destructive, false);
});

test("treats unmapped physical columns as destructive removals in logical-to-physical plans", () => {
  const draft = reverseEngineerTable(orders);
  const logical = {
    ...draft,
    objectType: {
      ...draft.objectType,
      attributes: Object.fromEntries(Object.entries(draft.objectType.attributes).filter(([name]) => name !== "payload")),
    },
    physical: {
      ...draft.physical,
      attributes: Object.fromEntries(Object.entries(draft.physical.attributes).filter(([name]) => name !== "payload")),
    },
  };

  const plan = generateSchemaChangePlan(orders, logical);
  assert.ok(plan.operations.some((operation) => operation.kind === "drop-column" && operation.column === "payload"));
  assert.equal(plan.destructive, true);
});

test("uses conservative lossless logical types for database primitives", () => {
  assert.equal(logicalTypeForColumn({ dataType: "tinyint", databaseType: "tinyint(1)" }), "boolean");
  assert.equal(logicalTypeForColumn({ dataType: "bigint", databaseType: "bigint" }), "string");
  assert.equal(logicalTypeForColumn({ dataType: "blob", databaseType: "longblob" }), "binary");
  assert.equal(logicalTypeForColumn({ dataType: "json", databaseType: "json" }), "json");
});

function column(name, ordinal, dataType, databaseType, nullable, extra = {}) {
  return {
    name,
    ordinal,
    dataType,
    databaseType,
    nullable,
    autoIncrement: false,
    generated: false,
    ...extra,
  };
}

function index(name, primary, unique, columns) {
  return {
    name,
    primary,
    unique,
    columns: columns.map((columnName, offset) => ({ name: columnName, sequence: offset + 1 })),
  };
}

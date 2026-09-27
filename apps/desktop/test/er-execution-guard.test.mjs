import assert from "node:assert/strict";
import test from "node:test";

import {
  assertErExecutionGuard,
  ER_CONFIRMATION,
  ER_DESTRUCTIVE_CONFIRMATION,
  erExecutionFingerprint,
  requiredErConfirmation,
} from "../dist/main/er-execution-guard.js";

const source = {
  relation: { key: "demo\u001f\u001forders", catalog: "demo", name: "orders", kind: "table" },
  columns: [{ name: "customer_id", ordinal: 1, dataType: "int", databaseType: "int", nullable: false, autoIncrement: false, generated: false }],
  indexes: [],
  foreignKeys: [],
};
const target = {
  relation: { key: "demo\u001f\u001fcustomers", catalog: "demo", name: "customers", kind: "table" },
  columns: [{ name: "id", ordinal: 1, dataType: "int", databaseType: "int", nullable: false, autoIncrement: true, generated: false }],
  indexes: [],
  foreignKeys: [],
};
const plan = {
  source: "er-designer",
  catalog: "demo",
  table: "orders",
  operations: [{ kind: "add-foreign-key", table: "orders", name: "fk_orders_customers", columns: ["customer_id"], referencedCatalog: "demo", referencedTable: "customers", referencedColumns: ["id"], onDelete: "restrict", destructive: false }],
  destructive: false,
};
const preview = { providerId: "mysql", statements: ["ALTER TABLE ..."], destructive: false, warnings: [] };

test("ER fingerprint captures current source and target metadata", () => {
  const first = erExecutionFingerprint("conn", source, target, plan, preview);
  const second = erExecutionFingerprint("conn", { ...source, foreignKeys: [{ name: "other", columns: ["customer_id"], referencedTable: "customers", referencedColumns: ["id"] }] }, target, plan, preview);
  assert.notEqual(first, second);
});

test("ER guard uses stronger confirmation for destructive operations", () => {
  assert.equal(requiredErConfirmation(false), ER_CONFIRMATION);
  assert.equal(requiredErConfirmation(true), ER_DESTRUCTIVE_CONFIRMATION);
  const fingerprint = erExecutionFingerprint("conn", source, target, plan, preview);
  assert.doesNotThrow(() => assertErExecutionGuard(fingerprint, fingerprint, false, ER_CONFIRMATION));
  assert.throws(() => assertErExecutionGuard(fingerprint, fingerprint, false, "wrong"), /exact confirmation/u);
  assert.throws(() => assertErExecutionGuard(fingerprint, "stale", false, ER_CONFIRMATION), /stale/u);
});

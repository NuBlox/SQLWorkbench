import assert from "node:assert/strict";
import test from "node:test";

import {
  DESTRUCTIVE_CONFIRMATION,
  NON_DESTRUCTIVE_CONFIRMATION,
  assertSchemaExecutionGuard,
  requiredSchemaConfirmation,
  schemaExecutionFingerprint,
} from "../dist/electron/main/schema-execution-guard.js";

const request = {
  connectionId: "local",
  catalog: "sales",
  name: "orders",
  includeSystem: false,
  draft: {
    objectTypeId: "db:sales.orders",
    logicalName: "Orders",
    catalog: "sales",
    table: "orders",
    kind: "table",
    attributes: [],
    relationships: [],
    indexes: [],
    primaryKey: [],
  },
};
const table = {
  catalog: "sales",
  name: "orders",
  kind: "table",
  columns: [],
  indexes: [],
  foreignKeys: [],
};
const preview = {
  draft: request.draft,
  differences: [],
  neutralPlan: { source: "metaobject", catalog: "sales", table: "orders", operations: [], destructive: false },
  providerPlan: { source: "metaobject", catalog: "sales", table: "orders", operations: [], destructive: false },
  providerPreview: { providerId: "mysql", statements: ["ALTER TABLE `sales`.`orders` ADD COLUMN `status` VARCHAR(30) NULL;"], destructive: false, warnings: [] },
};

test("schema execution fingerprints are stable for identical live inputs", () => {
  const first = schemaExecutionFingerprint(request, table, preview);
  const second = schemaExecutionFingerprint(request, table, preview);
  assert.equal(first, second);
  assert.equal(first.length, 64);
});

test("schema execution fingerprint changes when live metadata changes", () => {
  const first = schemaExecutionFingerprint(request, table, preview);
  const changed = schemaExecutionFingerprint(request, { ...table, columns: [{ name: "status", ordinal: 1, dataType: "varchar", databaseType: "varchar(30)", nullable: true, autoIncrement: false, generated: false }] }, preview);
  assert.notEqual(first, changed);
});

test("guard rejects stale previews and incorrect confirmation phrases", () => {
  const fingerprint = schemaExecutionFingerprint(request, table, preview);
  assert.throws(
    () => assertSchemaExecutionGuard(fingerprint, "stale", false, NON_DESTRUCTIVE_CONFIRMATION),
    /preview is stale/i,
  );
  assert.throws(
    () => assertSchemaExecutionGuard(fingerprint, fingerprint, false, "yes"),
    /requires the exact confirmation phrase/i,
  );
  assert.doesNotThrow(() => assertSchemaExecutionGuard(fingerprint, fingerprint, false, NON_DESTRUCTIVE_CONFIRMATION));
});

test("destructive plans require the stronger destructive confirmation", () => {
  assert.equal(requiredSchemaConfirmation(false), NON_DESTRUCTIVE_CONFIRMATION);
  assert.equal(requiredSchemaConfirmation(true), DESTRUCTIVE_CONFIRMATION);
  assert.throws(
    () => assertSchemaExecutionGuard("abc", "abc", true, NON_DESTRUCTIVE_CONFIRMATION),
    /APPLY DESTRUCTIVE CHANGES/,
  );
  assert.doesNotThrow(() => assertSchemaExecutionGuard("abc", "abc", true, DESTRUCTIVE_CONFIRMATION));
});

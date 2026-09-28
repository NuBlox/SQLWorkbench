import assert from "node:assert/strict";
import test from "node:test";

import { PostgreSqlMigrationProvider } from "../dist/migration.js";

const provider = new PostgreSqlMigrationProvider();

function plan(operations, overrides = {}) {
  return {
    source: "test",
    schema: "app",
    table: "orders",
    operations,
    destructive: operations.some((operation) => operation.destructive),
    ...overrides,
  };
}

test("renders PostgreSQL add column and logical type defaults", () => {
  const preview = provider.preview(plan([
    { kind: "add-column", table: "orders", column: "payload", logicalType: "json", nullable: false, destructive: false },
  ]));
  assert.deepEqual(preview.statements, [
    'ALTER TABLE "app"."orders" ADD COLUMN "payload" JSONB NOT NULL;',
  ]);
  assert.equal(preview.destructive, false);
});

test("renders PostgreSQL alter column type and nullability separately", () => {
  const preview = provider.preview(plan([
    { kind: "alter-column", table: "orders", column: "total", logicalType: "decimal", databaseType: "numeric(20,4)", nullable: true, destructive: false },
  ]));
  assert.deepEqual(preview.statements, [
    'ALTER TABLE "app"."orders" ALTER COLUMN "total" TYPE numeric(20,4);',
    'ALTER TABLE "app"."orders" ALTER COLUMN "total" DROP NOT NULL;',
  ]);
});

test("renders PostgreSQL foreign keys with schema qualification and DROP CONSTRAINT", () => {
  const preview = provider.preview(plan([
    {
      kind: "add-foreign-key",
      table: "orders",
      name: "orders_customer_fk",
      columns: ["customer_id"],
      referencedSchema: "crm",
      referencedTable: "customers",
      referencedColumns: ["id"],
      onDelete: "cascade",
      destructive: false,
    },
    { kind: "drop-foreign-key", table: "orders", name: "orders_legacy_fk", destructive: true },
  ]));
  assert.equal(preview.statements[0], 'ALTER TABLE "app"."orders" ADD CONSTRAINT "orders_customer_fk" FOREIGN KEY ("customer_id") REFERENCES "crm"."customers" ("id") ON DELETE CASCADE;');
  assert.equal(preview.statements[1], 'ALTER TABLE "app"."orders" DROP CONSTRAINT "orders_legacy_fk";');
  assert.equal(preview.destructive, true);
  assert.match(preview.warnings[0], /destructive/i);
});

test("renders schema-qualified PostgreSQL index drops", () => {
  const preview = provider.preview(plan([
    { kind: "create-index", table: "orders", name: "orders_ref_idx", unique: false, columns: ["reference"], destructive: false },
    { kind: "drop-index", table: "orders", name: "orders_old_idx", destructive: true },
  ]));
  assert.equal(preview.statements[0], 'CREATE INDEX "orders_ref_idx" ON "app"."orders" ("reference");');
  assert.equal(preview.statements[1], 'DROP INDEX "app"."orders_old_idx";');
});

test("warns when database catalog and detach semantics cannot be represented directly", () => {
  const preview = provider.preview(plan([
    {
      kind: "add-foreign-key",
      table: "orders",
      name: "orders_customer_fk",
      columns: ["customer_id"],
      referencedCatalog: "other_db",
      referencedSchema: "crm",
      referencedTable: "customers",
      referencedColumns: ["id"],
      onDelete: "detach",
      destructive: false,
    },
  ], { catalog: "workbench" }));
  assert.equal(preview.warnings.length, 3);
  assert.match(preview.warnings.join("\n"), /cross-database/i);
  assert.match(preview.warnings.join("\n"), /NO ACTION/i);
  assert.match(preview.statements[0], /ON DELETE NO ACTION/);
});

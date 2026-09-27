import assert from "node:assert/strict";
import test from "node:test";

import { MySqlMigrationProvider } from "../dist/migration.js";

const provider = new MySqlMigrationProvider();

test("renders provider-neutral schema changes as quoted MySQL DDL", () => {
  const preview = provider.preview({
    source: "metaobject",
    catalog: "sales-db",
    table: "order`lines",
    destructive: false,
    operations: [
      {
        kind: "add-column",
        table: "order`lines",
        column: "status",
        logicalType: "string",
        databaseType: "varchar(30)",
        nullable: false,
        destructive: false,
      },
      {
        kind: "create-index",
        table: "order`lines",
        name: "ix_status",
        unique: false,
        columns: ["status"],
        destructive: false,
      },
    ],
  });

  assert.deepEqual(preview.statements, [
    "ALTER TABLE `sales-db`.`order``lines` ADD COLUMN `status` varchar(30) NOT NULL;",
    "CREATE INDEX `ix_status` ON `sales-db`.`order``lines` (`status`);",
  ]);
  assert.equal(preview.destructive, false);
  assert.deepEqual(preview.warnings, []);
});

test("maps relationship actions and warns for destructive or detach semantics", () => {
  const preview = provider.preview({
    source: "metaobject",
    catalog: "sales",
    table: "orders",
    destructive: true,
    operations: [
      {
        kind: "add-foreign-key",
        table: "orders",
        name: "fk_orders_customer",
        columns: ["customer_id"],
        referencedCatalog: "sales",
        referencedTable: "customers",
        referencedColumns: ["customer_id"],
        onDelete: "detach",
        destructive: false,
      },
      {
        kind: "drop-column",
        table: "orders",
        column: "legacy_code",
        destructive: true,
      },
    ],
  });

  assert.match(preview.statements[0], /ON DELETE NO ACTION/);
  assert.equal(preview.statements[1], "ALTER TABLE `sales`.`orders` DROP COLUMN `legacy_code`;");
  assert.equal(preview.destructive, true);
  assert.equal(preview.warnings.length, 2);
});

test("falls back from logical metaobject types to sensible MySQL types", () => {
  const preview = provider.preview({
    source: "metaobject",
    table: "objects",
    destructive: false,
    operations: [
      { kind: "add-column", table: "objects", column: "payload", logicalType: "json", nullable: true, destructive: false },
      { kind: "add-column", table: "objects", column: "object_id", logicalType: "uuid", nullable: false, destructive: false },
    ],
  });

  assert.equal(preview.statements[0], "ALTER TABLE `objects` ADD COLUMN `payload` JSON NULL;");
  assert.equal(preview.statements[1], "ALTER TABLE `objects` ADD COLUMN `object_id` CHAR(36) NOT NULL;");
});

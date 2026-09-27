import assert from "node:assert/strict";
import test from "node:test";

import { MySqlWorkbenchProvider } from "../dist/workbench.js";

test("Workbench MySQL composition advertises migration preview through provider contract", () => {
  const provider = new MySqlWorkbenchProvider();
  assert.equal(provider.id, "mysql");
  assert.equal(provider.capabilities.migrationPreview, true);
  assert.ok(provider.migrations);

  const preview = provider.migrations.preview({
    source: "metaobject",
    table: "orders",
    operations: [
      {
        kind: "add-column",
        table: "orders",
        column: "status",
        logicalType: "string",
        databaseType: "varchar(30)",
        nullable: true,
        destructive: false,
      },
    ],
    destructive: false,
  });

  assert.equal(preview.providerId, "mysql");
  assert.equal(preview.statements[0], "ALTER TABLE `orders` ADD COLUMN `status` varchar(30) NULL;");
});

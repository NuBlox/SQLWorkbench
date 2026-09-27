import type { DatabaseCapabilities, DatabaseMigrationProvider } from "@nublox/workbench-provider-api";

import { MySqlDatabaseProvider, mysqlCapabilities } from "./index.js";
import { mysqlMigrationProvider } from "./migration.js";

/**
 * Full SQL Workbench provider composition. The core MySQL provider remains
 * usable without schema-engineering concerns, while the Workbench composition
 * advertises and supplies migration-preview support through the provider API.
 */
export class MySqlWorkbenchProvider extends MySqlDatabaseProvider {
  override readonly capabilities: DatabaseCapabilities = Object.freeze({
    ...mysqlCapabilities,
    migrationPreview: true,
  });

  readonly migrations: DatabaseMigrationProvider = mysqlMigrationProvider;
}

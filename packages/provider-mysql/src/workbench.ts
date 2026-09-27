import type {
  DatabaseCapabilities,
  DatabaseMigrationProvider,
  DatabaseViewProvider,
} from "@nublox/workbench-provider-api";

import { MySqlDatabaseProvider, mysqlCapabilities } from "./index.js";
import { mysqlMigrationProvider } from "./migration.js";
import { MySqlViewEngineeringProvider } from "./view-engineering.js";

/**
 * Full SQL Workbench provider composition. The core MySQL provider remains
 * usable without schema-engineering concerns, while the Workbench composition
 * advertises migration and view-definition engineering through provider-neutral
 * contracts.
 */
export class MySqlWorkbenchProvider extends MySqlDatabaseProvider {
  override readonly capabilities: DatabaseCapabilities = Object.freeze({
    ...mysqlCapabilities,
    migrationPreview: true,
    viewDefinitionEditing: true,
  });

  readonly migrations: DatabaseMigrationProvider = mysqlMigrationProvider;
  readonly viewEngineering: DatabaseViewProvider = new MySqlViewEngineeringProvider(this);
}

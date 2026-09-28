import type {
  DatabaseAdministrationProvider,
  DatabaseCapabilities,
  DatabaseMigrationProvider,
  DatabaseViewProvider,
} from "@nublox/workbench-provider-api";

import { MySqlAdministrationProvider, mysqlAdministrationCapabilities } from "./administration.js";
import { MySqlDatabaseProvider, mysqlCapabilities } from "./index.js";
import { mysqlMigrationProvider } from "./migration.js";
import { MySqlViewEngineeringProvider } from "./view-engineering.js";

/**
 * Full SQL Workbench provider composition. The core MySQL provider remains
 * usable without Workbench-specific engineering and administration concerns,
 * while this composition advertises them through provider-neutral contracts.
 */
export class MySqlWorkbenchProvider extends MySqlDatabaseProvider {
  override readonly capabilities: DatabaseCapabilities = Object.freeze({
    ...mysqlCapabilities,
    migrationPreview: true,
    viewDefinitionEditing: true,
    administration: mysqlAdministrationCapabilities,
    serverAdministration: true,
    userAdministration: true,
  });

  readonly administration: DatabaseAdministrationProvider = new MySqlAdministrationProvider(this);
  readonly migrations: DatabaseMigrationProvider = mysqlMigrationProvider;
  readonly viewEngineering: DatabaseViewProvider = new MySqlViewEngineeringProvider(this);
}

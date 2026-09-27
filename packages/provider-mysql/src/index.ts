import {
  WorkbenchCapabilities,
  type DatabaseProviderDefinition,
} from "@nublox/sql-workbench-core";

const plannedCapabilities = [
  WorkbenchCapabilities.CONNECTION,
  WorkbenchCapabilities.SQL_EXECUTION,
  WorkbenchCapabilities.SQL_TRANSACTIONS,
  WorkbenchCapabilities.SQL_EXPLAIN,
  WorkbenchCapabilities.SCHEMA_INTROSPECTION,
  WorkbenchCapabilities.SCHEMA_DDL,
  WorkbenchCapabilities.DATA_BROWSE,
  WorkbenchCapabilities.DATA_EDIT,
  WorkbenchCapabilities.ROUTINES,
  WorkbenchCapabilities.MIGRATIONS,
  WorkbenchCapabilities.ADMIN_SESSIONS,
  WorkbenchCapabilities.ADMIN_VARIABLES,
  WorkbenchCapabilities.ADMIN_USERS,
  WorkbenchCapabilities.ADMIN_PRIVILEGES,
  WorkbenchCapabilities.ADMIN_STORAGE,
  WorkbenchCapabilities.BACKUP,
  WorkbenchCapabilities.RESTORE,
  WorkbenchCapabilities.IMPORT,
  WorkbenchCapabilities.EXPORT,
  WorkbenchCapabilities.METADATA_MODELLING,
] as const;

export const mysqlProviderDefinition: DatabaseProviderDefinition = {
  id: "mysql",
  displayName: "MySQL",
  version: "0.1.0",
  dialects: [
    {
      id: "mysql",
      displayName: "MySQL SQL",
    },
  ],
  capabilities: [],
  plannedCapabilities,
};

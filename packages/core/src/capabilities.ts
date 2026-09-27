export const WorkbenchCapabilities = {
  CONNECTION: "connection",
  SQL_EXECUTION: "sql.execution",
  SQL_TRANSACTIONS: "sql.transactions",
  SQL_EXPLAIN: "sql.explain",
  SCHEMA_INTROSPECTION: "schema.introspection",
  SCHEMA_DDL: "schema.ddl",
  DATA_BROWSE: "data.browse",
  DATA_EDIT: "data.edit",
  ROUTINES: "database.routines",
  MIGRATIONS: "database.migrations",
  ADMIN_SESSIONS: "admin.sessions",
  ADMIN_VARIABLES: "admin.variables",
  ADMIN_USERS: "admin.users",
  ADMIN_PRIVILEGES: "admin.privileges",
  ADMIN_STORAGE: "admin.storage",
  BACKUP: "operations.backup",
  RESTORE: "operations.restore",
  IMPORT: "operations.import",
  EXPORT: "operations.export",
  METADATA_MODELLING: "metadata.modelling",
} as const;

export type WorkbenchCapability =
  (typeof WorkbenchCapabilities)[keyof typeof WorkbenchCapabilities];

export function hasCapability(
  capabilities: readonly WorkbenchCapability[],
  capability: WorkbenchCapability,
): boolean {
  return capabilities.includes(capability);
}

import type {
  DatabaseMigrationPreview,
  DatabaseMigrationProvider,
  DatabaseReferentialAction,
  DatabaseSchemaChangeOperation,
  DatabaseSchemaChangePlan,
} from "@nublox/workbench-provider-api";

export class PostgreSqlMigrationProvider implements DatabaseMigrationProvider {
  readonly providerId = "postgresql";

  preview(plan: DatabaseSchemaChangePlan): DatabaseMigrationPreview {
    const statements = plan.operations.flatMap((operation) => renderOperation(plan, operation));
    const warnings: string[] = [];

    if (plan.destructive) {
      warnings.push("Plan contains destructive schema operations. Review every statement before execution.");
    }
    if (plan.catalog) {
      warnings.push("PostgreSQL database/catalog qualifiers are not emitted in DDL because PostgreSQL does not support cross-database object qualification.");
    }
    if (plan.operations.some((operation) => operation.kind === "add-foreign-key" && operation.referencedCatalog)) {
      warnings.push("PostgreSQL foreign keys cannot reference a table in another database; referencedCatalog is not emitted.");
    }
    if (plan.operations.some((operation) => operation.kind === "add-foreign-key" && operation.onDelete === "detach")) {
      warnings.push("Metaobject detach semantics are previewed as PostgreSQL ON DELETE NO ACTION unless a future guarded migration supplies an explicit nullable SET NULL policy.");
    }

    return {
      providerId: this.providerId,
      statements,
      destructive: plan.destructive,
      warnings,
    };
  }
}

export const postgresqlMigrationProvider = new PostgreSqlMigrationProvider();

function renderOperation(plan: DatabaseSchemaChangePlan, operation: DatabaseSchemaChangeOperation): string[] {
  const table = qualifiedTable(plan.schema, operation.table);

  switch (operation.kind) {
    case "add-column":
      return [`ALTER TABLE ${table} ADD COLUMN ${quote(operation.column)} ${columnType(operation)} ${nullability(operation.nullable)};`];
    case "drop-column":
      return [`ALTER TABLE ${table} DROP COLUMN ${quote(operation.column)};`];
    case "alter-column":
      return [
        `ALTER TABLE ${table} ALTER COLUMN ${quote(operation.column)} TYPE ${columnType(operation)};`,
        `ALTER TABLE ${table} ALTER COLUMN ${quote(operation.column)} ${operation.nullable ? "DROP" : "SET"} NOT NULL;`,
      ];
    case "add-foreign-key":
      return [`ALTER TABLE ${table} ADD CONSTRAINT ${quote(operation.name)} FOREIGN KEY (${operation.columns.map(quote).join(", ")}) REFERENCES ${referencedTable(operation)} (${operation.referencedColumns.map(quote).join(", ")})${operation.onDelete ? ` ON DELETE ${deleteRule(operation.onDelete)}` : ""};`];
    case "drop-foreign-key":
      return [`ALTER TABLE ${table} DROP CONSTRAINT ${quote(operation.name)};`];
    case "create-index":
      return [`CREATE ${operation.unique ? "UNIQUE " : ""}INDEX ${quote(operation.name)} ON ${table} (${operation.columns.map(quote).join(", ")});`];
    case "drop-index":
      return [`DROP INDEX ${qualifiedIndex(plan.schema, operation.name)};`];
  }
}

function columnType(operation: Extract<DatabaseSchemaChangeOperation, { kind: "add-column" | "alter-column" }>): string {
  return operation.databaseType?.trim() || defaultDatabaseType(operation.logicalType);
}

function defaultDatabaseType(logicalType: string): string {
  switch (logicalType.trim().toLowerCase()) {
    case "boolean": return "BOOLEAN";
    case "integer": return "INTEGER";
    case "number": return "DOUBLE PRECISION";
    case "decimal": return "NUMERIC(38,10)";
    case "date": return "DATE";
    case "datetime": return "TIMESTAMP WITH TIME ZONE";
    case "uuid": return "UUID";
    case "json": return "JSONB";
    case "binary": return "BYTEA";
    case "string":
    default: return "VARCHAR(255)";
  }
}

function qualifiedTable(schema: string | undefined, table: string): string {
  return schema ? `${quote(schema)}.${quote(table)}` : quote(table);
}

function qualifiedIndex(schema: string | undefined, index: string): string {
  return schema ? `${quote(schema)}.${quote(index)}` : quote(index);
}

function referencedTable(operation: Extract<DatabaseSchemaChangeOperation, { kind: "add-foreign-key" }>): string {
  return operation.referencedSchema
    ? `${quote(operation.referencedSchema)}.${quote(operation.referencedTable)}`
    : quote(operation.referencedTable);
}

function nullability(nullable: boolean): string {
  return nullable ? "NULL" : "NOT NULL";
}

function deleteRule(action: DatabaseReferentialAction): string {
  if (action === "cascade") return "CASCADE";
  if (action === "restrict") return "RESTRICT";
  return "NO ACTION";
}

function quote(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

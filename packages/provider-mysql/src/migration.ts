import type {
  DatabaseMigrationPreview,
  DatabaseMigrationProvider,
  DatabaseReferentialAction,
  DatabaseSchemaChangeOperation,
  DatabaseSchemaChangePlan,
} from "@nublox/workbench-provider-api";

export class MySqlMigrationProvider implements DatabaseMigrationProvider {
  readonly providerId = "mysql";

  preview(plan: DatabaseSchemaChangePlan): DatabaseMigrationPreview {
    const statements = plan.operations.map((operation) => renderOperation(plan, operation));
    const warnings: string[] = [];
    if (plan.destructive) {
      warnings.push("Plan contains destructive schema operations. Review every statement before execution.");
    }
    if (plan.operations.some((operation) => operation.kind === "add-foreign-key" && operation.onDelete === "detach")) {
      warnings.push("Metaobject detach semantics are previewed as MySQL ON DELETE NO ACTION unless a future guarded migration supplies an explicit nullable SET NULL policy.");
    }
    return {
      providerId: this.providerId,
      statements,
      destructive: plan.destructive,
      warnings,
    };
  }
}

export const mysqlMigrationProvider = new MySqlMigrationProvider();

function renderOperation(plan: DatabaseSchemaChangePlan, operation: DatabaseSchemaChangeOperation): string {
  const table = qualifiedTable(plan, operation.table);
  switch (operation.kind) {
    case "add-column":
      return `ALTER TABLE ${table} ADD COLUMN ${quote(operation.column)} ${columnType(operation)} ${nullability(operation.nullable)};`;
    case "drop-column":
      return `ALTER TABLE ${table} DROP COLUMN ${quote(operation.column)};`;
    case "alter-column":
      return `ALTER TABLE ${table} MODIFY COLUMN ${quote(operation.column)} ${columnType(operation)} ${nullability(operation.nullable)};`;
    case "add-foreign-key":
      return `ALTER TABLE ${table} ADD CONSTRAINT ${quote(operation.name)} FOREIGN KEY (${operation.columns.map(quote).join(", ")}) REFERENCES ${referencedTable(operation)} (${operation.referencedColumns.map(quote).join(", ")})${operation.onDelete ? ` ON DELETE ${deleteRule(operation.onDelete)}` : ""};`;
    case "drop-foreign-key":
      return `ALTER TABLE ${table} DROP FOREIGN KEY ${quote(operation.name)};`;
    case "create-index":
      return `CREATE ${operation.unique ? "UNIQUE " : ""}INDEX ${quote(operation.name)} ON ${table} (${operation.columns.map(quote).join(", ")});`;
    case "drop-index":
      return `DROP INDEX ${quote(operation.name)} ON ${table};`;
  }
}

function columnType(operation: Extract<DatabaseSchemaChangeOperation, { kind: "add-column" | "alter-column" }>): string {
  return operation.databaseType?.trim() || defaultDatabaseType(operation.logicalType);
}

function defaultDatabaseType(logicalType: string): string {
  switch (logicalType.trim().toLowerCase()) {
    case "boolean": return "BOOLEAN";
    case "integer": return "INT";
    case "number": return "DOUBLE";
    case "decimal": return "DECIMAL(38,10)";
    case "date": return "DATE";
    case "datetime": return "DATETIME";
    case "uuid": return "CHAR(36)";
    case "json": return "JSON";
    case "binary": return "LONGBLOB";
    case "string":
    default: return "VARCHAR(255)";
  }
}

function qualifiedTable(plan: DatabaseSchemaChangePlan, table: string): string {
  const qualifier = plan.catalog ?? plan.schema;
  return qualifier ? `${quote(qualifier)}.${quote(table)}` : quote(table);
}

function referencedTable(operation: Extract<DatabaseSchemaChangeOperation, { kind: "add-foreign-key" }>): string {
  const qualifier = operation.referencedCatalog ?? operation.referencedSchema;
  return qualifier ? `${quote(qualifier)}.${quote(operation.referencedTable)}` : quote(operation.referencedTable);
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
  return `\`${identifier.replaceAll("`", "``")}\``;
}

export interface DatabaseCatalog {
  readonly providerId: string;
  readonly server: DatabaseServerInfo;
  readonly namespaces: readonly DatabaseNamespace[];
  readonly capturedAt: string;
}

export interface DatabaseServerInfo {
  readonly product: string;
  readonly version?: string;
  readonly host?: string;
}

export interface DatabaseNamespaceReference {
  readonly catalog?: string;
  readonly schema?: string;
}

export interface DatabaseNamespaceSummary extends DatabaseNamespaceReference {
  readonly defaultCharacterSet?: string;
  readonly defaultCollation?: string;
  readonly system: boolean;
}

export interface DatabaseNamespace extends DatabaseNamespaceSummary {
  readonly tables: readonly TableDefinition[];
}

export type DatabaseObjectKind =
  | "table"
  | "view"
  | "procedure"
  | "function"
  | "trigger"
  | "event";

export interface DatabaseObjectSummary extends DatabaseNamespaceReference {
  readonly name: string;
  readonly kind: DatabaseObjectKind;
  readonly comment?: string;
}

export interface TableDefinition extends DatabaseObjectSummary {
  readonly kind: "table" | "view";
  readonly engine?: string;
  readonly estimatedRows?: number;
  readonly columns: readonly ColumnDefinition[];
  readonly indexes: readonly IndexDefinition[];
  readonly foreignKeys: readonly ForeignKeyDefinition[];
}

export interface ColumnDefinition {
  readonly name: string;
  readonly ordinal: number;
  readonly dataType: string;
  readonly databaseType: string;
  readonly nullable: boolean;
  readonly defaultValue?: unknown;
  readonly characterLength?: number;
  readonly numericPrecision?: number;
  readonly numericScale?: number;
  readonly datetimePrecision?: number;
  readonly autoIncrement: boolean;
  readonly generated: boolean;
  readonly generationExpression?: string;
  readonly comment?: string;
}

export interface IndexDefinition {
  readonly name: string;
  readonly primary: boolean;
  readonly unique: boolean;
  readonly type?: string;
  readonly columns: readonly IndexColumnDefinition[];
}

export interface IndexColumnDefinition {
  readonly name: string;
  readonly sequence: number;
  readonly prefixLength?: number;
  readonly direction?: "asc" | "desc";
}

export interface ForeignKeyDefinition {
  readonly name: string;
  readonly columns: readonly string[];
  readonly referencedCatalog?: string;
  readonly referencedSchema?: string;
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly updateRule?: string;
  readonly deleteRule?: string;
}

export interface RoutineDefinition extends DatabaseObjectSummary {
  readonly kind: "procedure" | "function";
  readonly dataType?: string;
  readonly definition?: string;
  readonly securityType?: string;
  readonly sqlDataAccess?: string;
  readonly deterministic?: boolean;
  readonly createdAt?: string;
  readonly alteredAt?: string;
}

export interface TriggerDefinition extends DatabaseObjectSummary {
  readonly kind: "trigger";
  readonly table: string;
  readonly event: string;
  readonly timing: string;
  readonly statement?: string;
}

export interface EventDefinition extends DatabaseObjectSummary {
  readonly kind: "event";
  readonly definition?: string;
  readonly scheduleType?: string;
  readonly executeAt?: string;
  readonly intervalValue?: string;
  readonly intervalField?: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly status?: string;
  readonly onCompletion?: string;
}

export interface DatabasePrincipal {
  readonly grantee: string;
  readonly name: string;
  readonly host?: string;
  readonly kind: "user" | "role" | "unknown";
}

export interface RoleGrantDefinition {
  readonly grantee: string;
  readonly role: string;
  readonly grantable: boolean;
  readonly defaultRole?: boolean;
}

export type DatabasePrivilegeScope = "global" | "schema" | "table" | "column";

export interface DatabasePrivilege extends DatabaseNamespaceReference {
  readonly grantee: string;
  readonly privilege: string;
  readonly scope: DatabasePrivilegeScope;
  readonly table?: string;
  readonly column?: string;
  readonly grantable: boolean;
}

export interface DatabaseSearchResult extends DatabaseObjectSummary {}

export interface QualifiedObjectName extends DatabaseNamespaceReference {
  readonly name: string;
}

export function qualifiedObjectKey(value: QualifiedObjectName): string {
  return [value.catalog ?? "", value.schema ?? "", value.name].join("\u001f");
}

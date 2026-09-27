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

export interface DatabaseNamespace {
  readonly catalog?: string;
  readonly schema?: string;
  readonly defaultCharacterSet?: string;
  readonly defaultCollation?: string;
  readonly system: boolean;
  readonly tables: readonly TableDefinition[];
}

export interface TableDefinition {
  readonly catalog?: string;
  readonly schema?: string;
  readonly name: string;
  readonly kind: "table" | "view";
  readonly engine?: string;
  readonly estimatedRows?: number;
  readonly comment?: string;
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

export interface QualifiedObjectName {
  readonly catalog?: string;
  readonly schema?: string;
  readonly name: string;
}

export function qualifiedObjectKey(value: QualifiedObjectName): string {
  return [value.catalog ?? "", value.schema ?? "", value.name].join("\u001f");
}

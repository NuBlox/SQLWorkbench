import { defineObjectType } from "@nublox/metaobject";
import type {
  AttributeDefinition,
  IndexDefinition as MetaIndexDefinition,
  ObjectTypeDefinition,
  ReferentialAction,
  RelationshipCardinality,
  RelationshipDefinition,
} from "@nublox/metaobject";
import type {
  ColumnDefinition,
  ForeignKeyDefinition,
  IndexDefinition,
  TableDefinition,
} from "@nublox/workbench-catalog";

export interface ReverseEngineeringOptions {
  readonly namespace?: string;
  readonly idPrefix?: string;
  readonly version?: number;
}

export interface PhysicalAttributeMapping {
  readonly attribute: string;
  readonly column: string;
  readonly ordinal: number;
  readonly dataType: string;
  readonly databaseType: string;
  readonly nullable: boolean;
  readonly defaultValue?: unknown;
  readonly autoIncrement: boolean;
  readonly generated: boolean;
  readonly generationExpression?: string;
  readonly comment?: string;
}

export interface PhysicalRelationshipMapping {
  readonly relationship: string;
  readonly foreignKey: string;
  readonly columns: readonly string[];
  readonly referencedCatalog?: string;
  readonly referencedSchema?: string;
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly updateRule?: string;
  readonly deleteRule?: string;
}

export interface PhysicalIndexMapping {
  readonly physicalName: string;
  readonly logicalName?: string;
  readonly primary: boolean;
  readonly unique: boolean;
  readonly columns: readonly string[];
}

export interface PhysicalObjectMapping {
  readonly providerNeutralKind: "table" | "view";
  readonly catalog?: string;
  readonly schema?: string;
  readonly table: string;
  readonly objectTypeId: string;
  readonly attributes: Readonly<Record<string, PhysicalAttributeMapping>>;
  readonly relationships: Readonly<Record<string, PhysicalRelationshipMapping>>;
  readonly indexes: readonly PhysicalIndexMapping[];
  readonly primaryKey: readonly string[];
}

export interface MetaobjectDraft {
  readonly objectType: ObjectTypeDefinition;
  readonly physical: PhysicalObjectMapping;
}

export type SchemaDifferenceKind =
  | "missing-logical-attribute"
  | "missing-physical-column"
  | "type-mismatch"
  | "nullability-mismatch"
  | "missing-logical-relationship"
  | "missing-physical-foreign-key"
  | "missing-logical-index"
  | "missing-physical-index";

export interface SchemaDifference {
  readonly kind: SchemaDifferenceKind;
  readonly path: string;
  readonly physical?: unknown;
  readonly logical?: unknown;
}

export type SchemaChangeOperation =
  | { readonly kind: "add-column"; readonly table: string; readonly column: string; readonly logicalType: string; readonly nullable: boolean; readonly destructive: false }
  | { readonly kind: "drop-column"; readonly table: string; readonly column: string; readonly destructive: true }
  | { readonly kind: "alter-column"; readonly table: string; readonly column: string; readonly logicalType: string; readonly nullable: boolean; readonly destructive: boolean }
  | { readonly kind: "add-foreign-key"; readonly table: string; readonly name: string; readonly columns: readonly string[]; readonly referencedCatalog?: string; readonly referencedSchema?: string; readonly referencedTable: string; readonly referencedColumns: readonly string[]; readonly onDelete?: ReferentialAction; readonly destructive: false }
  | { readonly kind: "drop-foreign-key"; readonly table: string; readonly name: string; readonly destructive: true }
  | { readonly kind: "create-index"; readonly table: string; readonly name: string; readonly unique: boolean; readonly columns: readonly string[]; readonly destructive: false }
  | { readonly kind: "drop-index"; readonly table: string; readonly name: string; readonly destructive: true };

export interface SchemaChangePlan {
  readonly source: "metaobject";
  readonly catalog?: string;
  readonly schema?: string;
  readonly table: string;
  readonly operations: readonly SchemaChangeOperation[];
  readonly destructive: boolean;
}

type PhysicalIdentity = {
  readonly catalog?: string | undefined;
  readonly schema?: string | undefined;
  readonly name: string;
};

export function reverseEngineerTable(table: TableDefinition, options: ReverseEngineeringOptions = {}): MetaobjectDraft {
  const id = objectTypeId(table, options);
  const names = new Set<string>();
  const attributes: Record<string, AttributeDefinition> = {};
  const attributeMappings: Record<string, PhysicalAttributeMapping> = {};
  const columnToAttribute = new Map<string, string>();

  for (const column of [...table.columns].sort((a, b) => a.ordinal - b.ordinal)) {
    const attribute = uniqueName(toPropertyName(column.name), names);
    names.add(attribute);
    columnToAttribute.set(column.name, attribute);
    attributes[attribute] = attributeDefinition(column, table.indexes);
    attributeMappings[attribute] = {
      attribute,
      column: column.name,
      ordinal: column.ordinal,
      dataType: column.dataType,
      databaseType: column.databaseType,
      nullable: column.nullable,
      ...(column.defaultValue !== undefined ? { defaultValue: column.defaultValue } : {}),
      autoIncrement: column.autoIncrement,
      generated: column.generated,
      ...(column.generationExpression !== undefined ? { generationExpression: column.generationExpression } : {}),
      ...(column.comment !== undefined ? { comment: column.comment } : {}),
    };
  }

  const relationshipNames = new Set<string>();
  const relationships: Record<string, RelationshipDefinition> = {};
  const relationshipMappings: Record<string, PhysicalRelationshipMapping> = {};
  for (const fk of table.foreignKeys) {
    const relationship = uniqueName(relationshipName(fk), relationshipNames);
    relationshipNames.add(relationship);
    relationships[relationship] = relationshipDefinition(table, fk, options);
    relationshipMappings[relationship] = {
      relationship,
      foreignKey: fk.name,
      columns: [...fk.columns],
      ...(fk.referencedCatalog !== undefined ? { referencedCatalog: fk.referencedCatalog } : {}),
      ...(fk.referencedSchema !== undefined ? { referencedSchema: fk.referencedSchema } : {}),
      referencedTable: fk.referencedTable,
      referencedColumns: [...fk.referencedColumns],
      ...(fk.updateRule !== undefined ? { updateRule: fk.updateRule } : {}),
      ...(fk.deleteRule !== undefined ? { deleteRule: fk.deleteRule } : {}),
    };
  }

  const indexes = metaIndexes(table.indexes, columnToAttribute);
  const namespace = options.namespace ?? physicalNamespace(table.catalog, table.schema);
  const objectType = defineObjectType({
    id,
    name: toTypeName(table.name),
    ...(namespace ? { namespace } : {}),
    version: options.version ?? 1,
    attributes,
    ...(Object.keys(relationships).length ? { relationships } : {}),
    ...(indexes.length ? { indexes } : {}),
  });

  return {
    objectType,
    physical: {
      providerNeutralKind: table.kind,
      ...(table.catalog !== undefined ? { catalog: table.catalog } : {}),
      ...(table.schema !== undefined ? { schema: table.schema } : {}),
      table: table.name,
      objectTypeId: id,
      attributes: attributeMappings,
      relationships: relationshipMappings,
      indexes: table.indexes.map((index) => ({
        physicalName: index.name,
        ...(!index.primary ? { logicalName: index.name } : {}),
        primary: index.primary,
        unique: index.unique,
        columns: index.columns.map((column) => column.name),
      })),
      primaryKey: table.indexes.find((index) => index.primary)?.columns.map((column) => column.name) ?? [],
    },
  };
}

export function reverseEngineerTables(tables: readonly TableDefinition[], options: ReverseEngineeringOptions = {}): readonly MetaobjectDraft[] {
  return tables.map((table) => reverseEngineerTable(table, options));
}

export function compareTableToMetaobject(table: TableDefinition, draft: MetaobjectDraft): readonly SchemaDifference[] {
  const result: SchemaDifference[] = [];
  const columns = new Map(table.columns.map((column) => [column.name, column]));
  const mappedColumns = new Set<string>();

  for (const [attributeName, attribute] of Object.entries(draft.objectType.attributes)) {
    const columnName = draft.physical.attributes[attributeName]?.column ?? attributeName;
    mappedColumns.add(columnName);
    const column = columns.get(columnName);
    if (!column) {
      result.push({ kind: "missing-physical-column", path: `attributes.${attributeName}`, logical: attribute });
      continue;
    }
    const physicalType = logicalTypeForColumn(column);
    if (physicalType !== attribute.type) result.push({ kind: "type-mismatch", path: `attributes.${attributeName}.type`, physical: physicalType, logical: attribute.type });
    const nullable = attribute.nullable ?? !attribute.required;
    if (nullable !== column.nullable) result.push({ kind: "nullability-mismatch", path: `attributes.${attributeName}.nullable`, physical: column.nullable, logical: nullable });
  }
  for (const column of table.columns) {
    if (!mappedColumns.has(column.name)) result.push({ kind: "missing-logical-attribute", path: `columns.${column.name}`, physical: column });
  }

  const physicalFks = new Set(table.foreignKeys.map((fk) => fk.name));
  const mappedFks = new Set<string>();
  for (const [name, relationship] of Object.entries(draft.objectType.relationships ?? {})) {
    const physicalName = draft.physical.relationships[name]?.foreignKey ?? name;
    mappedFks.add(physicalName);
    if (!physicalFks.has(physicalName)) result.push({ kind: "missing-physical-foreign-key", path: `relationships.${name}`, logical: relationship });
  }
  for (const fk of table.foreignKeys) {
    if (!mappedFks.has(fk.name)) result.push({ kind: "missing-logical-relationship", path: `foreignKeys.${fk.name}`, physical: fk });
  }

  const physicalIndexes = new Set(table.indexes.filter((index) => !index.primary).map((index) => index.name));
  const mappedIndexes = new Set<string>();
  for (const index of draft.objectType.indexes ?? []) {
    const physicalName = draft.physical.indexes.find((item) => item.logicalName === index.name)?.physicalName ?? index.name;
    mappedIndexes.add(physicalName);
    if (!physicalIndexes.has(physicalName)) result.push({ kind: "missing-physical-index", path: `indexes.${index.name}`, logical: index });
  }
  for (const index of table.indexes.filter((item) => !item.primary)) {
    if (!mappedIndexes.has(index.name)) result.push({ kind: "missing-logical-index", path: `indexes.${index.name}`, physical: index });
  }
  return result;
}

export function generateSchemaChangePlan(table: TableDefinition, draft: MetaobjectDraft): SchemaChangePlan {
  const operations: SchemaChangeOperation[] = [];
  for (const difference of compareTableToMetaobject(table, draft)) {
    const segments = difference.path.split(".");
    const name = segments.at(-1) ?? difference.path;
    if (difference.kind === "missing-physical-column") {
      const attribute = draft.objectType.attributes[name];
      if (attribute) operations.push({ kind: "add-column", table: table.name, column: draft.physical.attributes[name]?.column ?? name, logicalType: attribute.type, nullable: attribute.nullable ?? !attribute.required, destructive: false });
    } else if (difference.kind === "missing-logical-attribute") {
      operations.push({ kind: "drop-column", table: table.name, column: name, destructive: true });
    } else if (difference.kind === "type-mismatch" || difference.kind === "nullability-mismatch") {
      const attributeName = segments[1];
      const attribute = attributeName ? draft.objectType.attributes[attributeName] : undefined;
      if (attribute && attributeName) operations.push({ kind: "alter-column", table: table.name, column: draft.physical.attributes[attributeName]?.column ?? attributeName, logicalType: attribute.type, nullable: attribute.nullable ?? !attribute.required, destructive: difference.kind === "type-mismatch" || !(attribute.nullable ?? !attribute.required) });
    } else if (difference.kind === "missing-physical-foreign-key") {
      const physical = draft.physical.relationships[name];
      const logical = draft.objectType.relationships?.[name];
      if (physical && logical) operations.push({ kind: "add-foreign-key", table: table.name, name: physical.foreignKey, columns: physical.columns, ...(physical.referencedCatalog !== undefined ? { referencedCatalog: physical.referencedCatalog } : {}), ...(physical.referencedSchema !== undefined ? { referencedSchema: physical.referencedSchema } : {}), referencedTable: physical.referencedTable, referencedColumns: physical.referencedColumns, ...(logical.onTargetDelete !== undefined ? { onDelete: logical.onTargetDelete } : {}), destructive: false });
    } else if (difference.kind === "missing-logical-relationship") {
      operations.push({ kind: "drop-foreign-key", table: table.name, name, destructive: true });
    } else if (difference.kind === "missing-physical-index") {
      const logical = (draft.objectType.indexes ?? []).find((index) => index.name === name);
      if (logical) operations.push({ kind: "create-index", table: table.name, name: draft.physical.indexes.find((item) => item.logicalName === name)?.physicalName ?? name, unique: logical.unique ?? false, columns: logical.attributes.map((item) => draft.physical.attributes[item.attribute]?.column ?? item.attribute), destructive: false });
    } else if (difference.kind === "missing-logical-index") {
      operations.push({ kind: "drop-index", table: table.name, name, destructive: true });
    }
  }
  return {
    source: "metaobject",
    ...(table.catalog !== undefined ? { catalog: table.catalog } : {}),
    ...(table.schema !== undefined ? { schema: table.schema } : {}),
    table: table.name,
    operations,
    destructive: operations.some((operation) => operation.destructive),
  };
}

export function logicalTypeForColumn(column: Pick<ColumnDefinition, "dataType" | "databaseType">): string {
  const dataType = column.dataType.trim().toLowerCase();
  const databaseType = column.databaseType.trim().toLowerCase();
  if (dataType === "uuid") return "uuid";
  if (["boolean", "bool"].includes(dataType) || /^tinyint\s*\(\s*1\s*\)/.test(databaseType)) return "boolean";
  if (["tinyint", "smallint", "mediumint", "int", "integer", "year"].includes(dataType)) return "integer";
  if (["bigint", "serial", "bigserial"].includes(dataType)) return "string";
  if (["decimal", "numeric", "dec", "fixed"].includes(dataType)) return "decimal";
  if (["float", "double", "real"].includes(dataType)) return "number";
  if (dataType === "date") return "date";
  if (["datetime", "timestamp", "timestamptz"].includes(dataType)) return "datetime";
  if (["json", "jsonb"].includes(dataType)) return "json";
  if (["binary", "varbinary", "tinyblob", "blob", "mediumblob", "longblob", "bytea"].includes(dataType)) return "binary";
  return "string";
}

function attributeDefinition(column: ColumnDefinition, indexes: readonly IndexDefinition[]): AttributeDefinition {
  const unique = indexes.some((index) => index.unique && index.columns.length === 1 && index.columns[0]?.name === column.name);
  const required = !column.nullable && column.defaultValue === undefined && !column.autoIncrement && !column.generated;
  return {
    type: logicalTypeForColumn(column),
    ...(required ? { required: true } : {}),
    nullable: column.nullable,
    ...(column.autoIncrement || column.generated ? { readOnly: true } : {}),
    ...(unique ? { unique: true } : {}),
  };
}

function relationshipDefinition(table: TableDefinition, fk: ForeignKeyDefinition, options: ReverseEngineeringOptions): RelationshipDefinition {
  const columns = fk.columns.map((name) => table.columns.find((column) => column.name === name)).filter((column): column is ColumnDefinition => column !== undefined);
  const required = columns.length === fk.columns.length && columns.every((column) => !column.nullable);
  const target: PhysicalIdentity = {
    ...(fk.referencedCatalog !== undefined ? { catalog: fk.referencedCatalog } : {}),
    ...(fk.referencedSchema !== undefined ? { schema: fk.referencedSchema } : {}),
    name: fk.referencedTable,
  };
  return {
    target: objectTypeId(target, options),
    cardinality: relationshipCardinality(table, fk),
    ...(required ? { required: true } : {}),
    ownership: "none",
    kind: "association",
    onTargetDelete: referentialAction(fk.deleteRule),
  };
}

function relationshipCardinality(table: TableDefinition, fk: ForeignKeyDefinition): RelationshipCardinality {
  const columns = new Set(fk.columns);
  return table.indexes.some((index) => index.unique && index.columns.length === columns.size && index.columns.every((column) => columns.has(column.name))) ? "one-to-one" : "many-to-one";
}

function referentialAction(rule: string | undefined): ReferentialAction {
  switch (rule?.trim().toUpperCase()) {
    case "CASCADE": return "cascade";
    case "RESTRICT":
    case "NO ACTION": return "restrict";
    default: return "detach";
  }
}

function metaIndexes(indexes: readonly IndexDefinition[], names: ReadonlyMap<string, string>): readonly MetaIndexDefinition[] {
  return indexes.filter((index) => !index.primary).map((index) => ({
    name: index.name,
    ...(index.unique ? { unique: true } : {}),
    attributes: index.columns.map((column) => {
      const attribute = names.get(column.name);
      return attribute ? { attribute, ...(column.direction !== undefined ? { direction: column.direction } : {}) } : undefined;
    }).filter((item): item is { attribute: string; direction?: "asc" | "desc" } => item !== undefined),
  })).filter((index) => index.attributes.length > 0);
}

function objectTypeId(table: PhysicalIdentity, options: ReverseEngineeringOptions): string {
  const prefix = options.idPrefix?.trim() || "db";
  const path = [table.catalog, table.schema, table.name].filter((value): value is string => Boolean(value)).map(idSegment).join(".");
  return `${prefix}:${path}`;
}

function physicalNamespace(catalog?: string, schema?: string): string | undefined {
  const value = [catalog, schema].filter(Boolean).join(".");
  return value || undefined;
}

function relationshipName(fk: ForeignKeyDefinition): string {
  return toPropertyName((fk.name || fk.referencedTable).replace(/^fk[_-]?/i, ""));
}

function toPropertyName(value: string): string {
  const words = wordParts(value);
  return words.length ? words[0]!.toLowerCase() + words.slice(1).map(capitalize).join("") : "value";
}

function toTypeName(value: string): string {
  const words = wordParts(value);
  return words.length ? words.map(capitalize).join("") : "Object";
}

function wordParts(value: string): string[] {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^A-Za-z0-9]+/).filter(Boolean);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function idSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function uniqueName(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

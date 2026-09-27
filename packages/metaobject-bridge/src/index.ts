import { defineObjectType } from "@nublox/metaobject";
import type {
  AttributeDefinition,
  IndexDefinition as MetaobjectIndexDefinition,
  ObjectTypeDefinition,
  ReferentialAction,
  RelationshipDefinition,
  RelationshipCardinality,
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
  | {
      readonly kind: "add-column";
      readonly table: string;
      readonly column: string;
      readonly logicalType: string;
      readonly nullable: boolean;
      readonly destructive: false;
    }
  | {
      readonly kind: "drop-column";
      readonly table: string;
      readonly column: string;
      readonly destructive: true;
    }
  | {
      readonly kind: "alter-column";
      readonly table: string;
      readonly column: string;
      readonly logicalType: string;
      readonly nullable: boolean;
      readonly destructive: boolean;
    }
  | {
      readonly kind: "add-foreign-key";
      readonly table: string;
      readonly name: string;
      readonly columns: readonly string[];
      readonly referencedCatalog?: string;
      readonly referencedSchema?: string;
      readonly referencedTable: string;
      readonly referencedColumns: readonly string[];
      readonly onDelete?: ReferentialAction;
      readonly destructive: false;
    }
  | {
      readonly kind: "drop-foreign-key";
      readonly table: string;
      readonly name: string;
      readonly destructive: true;
    }
  | {
      readonly kind: "create-index";
      readonly table: string;
      readonly name: string;
      readonly unique: boolean;
      readonly columns: readonly string[];
      readonly destructive: false;
    }
  | {
      readonly kind: "drop-index";
      readonly table: string;
      readonly name: string;
      readonly destructive: true;
    };

export interface SchemaChangePlan {
  readonly source: "metaobject";
  readonly catalog?: string;
  readonly schema?: string;
  readonly table: string;
  readonly operations: readonly SchemaChangeOperation[];
  readonly destructive: boolean;
}

export function reverseEngineerTable(
  table: TableDefinition,
  options: ReverseEngineeringOptions = {},
): MetaobjectDraft {
  const id = objectTypeId(table, options);
  const namespace = options.namespace ?? physicalNamespace(table.catalog, table.schema);
  const version = options.version ?? 1;
  const attributeNames = new Set<string>();
  const attributes: Record<string, AttributeDefinition> = {};
  const attributeMappings: Record<string, PhysicalAttributeMapping> = {};
  const columnToAttribute = new Map<string, string>();

  for (const column of [...table.columns].sort((left, right) => left.ordinal - right.ordinal)) {
    const attribute = uniqueName(toPropertyName(column.name), attributeNames);
    attributeNames.add(attribute);
    columnToAttribute.set(column.name, attribute);
    attributes[attribute] = toAttributeDefinition(column, table.indexes);
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
      ...(column.generationExpression !== undefined
        ? { generationExpression: column.generationExpression }
        : {}),
      ...(column.comment !== undefined ? { comment: column.comment } : {}),
    };
  }

  const relationshipNames = new Set<string>();
  const relationships: Record<string, RelationshipDefinition> = {};
  const relationshipMappings: Record<string, PhysicalRelationshipMapping> = {};

  for (const foreignKey of table.foreignKeys) {
    const relationship = uniqueName(
      relationshipName(foreignKey),
      relationshipNames,
    );
    relationshipNames.add(relationship);
    relationships[relationship] = toRelationshipDefinition(table, foreignKey, options);
    relationshipMappings[relationship] = {
      relationship,
      foreignKey: foreignKey.name,
      columns: [...foreignKey.columns],
      ...(foreignKey.referencedCatalog !== undefined
        ? { referencedCatalog: foreignKey.referencedCatalog }
        : {}),
      ...(foreignKey.referencedSchema !== undefined
        ? { referencedSchema: foreignKey.referencedSchema }
        : {}),
      referencedTable: foreignKey.referencedTable,
      referencedColumns: [...foreignKey.referencedColumns],
      ...(foreignKey.updateRule !== undefined ? { updateRule: foreignKey.updateRule } : {}),
      ...(foreignKey.deleteRule !== undefined ? { deleteRule: foreignKey.deleteRule } : {}),
    };
  }

  const indexes = toMetaobjectIndexes(table.indexes, columnToAttribute);
  const definition = defineObjectType({
    id,
    name: toTypeName(table.name),
    ...(namespace ? { namespace } : {}),
    version,
    attributes,
    ...(Object.keys(relationships).length > 0 ? { relationships } : {}),
    ...(indexes.length > 0 ? { indexes } : {}),
  });

  return {
    objectType: definition,
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
        ...(index.primary ? {} : { logicalName: index.name }),
        primary: index.primary,
        unique: index.unique,
        columns: index.columns.map((column) => column.name),
      })),
      primaryKey:
        table.indexes.find((index) => index.primary)?.columns.map((column) => column.name) ?? [],
    },
  };
}

export function reverseEngineerTables(
  tables: readonly TableDefinition[],
  options: ReverseEngineeringOptions = {},
): readonly MetaobjectDraft[] {
  return tables.map((table) => reverseEngineerTable(table, options));
}

export function compareTableToMetaobject(
  table: TableDefinition,
  draft: MetaobjectDraft,
): readonly SchemaDifference[] {
  const differences: SchemaDifference[] = [];
  const physicalColumns = new Map(table.columns.map((column) => [column.name, column]));
  const mappedColumns = new Set<string>();

  for (const [attributeName, attribute] of Object.entries(draft.objectType.attributes)) {
    const mapping = draft.physical.attributes[attributeName];
    const columnName = mapping?.column ?? attributeName;
    const column = physicalColumns.get(columnName);
    mappedColumns.add(columnName);
    if (!column) {
      differences.push({
        kind: "missing-physical-column",
        path: `attributes.${attributeName}`,
        logical: attribute,
      });
      continue;
    }
    const inferredType = logicalTypeForColumn(column);
    if (inferredType !== attribute.type) {
      differences.push({
        kind: "type-mismatch",
        path: `attributes.${attributeName}.type`,
        physical: inferredType,
        logical: attribute.type,
      });
    }
    const logicalNullable = attribute.nullable ?? !attribute.required;
    if (logicalNullable !== column.nullable) {
      differences.push({
        kind: "nullability-mismatch",
        path: `attributes.${attributeName}.nullable`,
        physical: column.nullable,
        logical: logicalNullable,
      });
    }
  }

  for (const column of table.columns) {
    if (!mappedColumns.has(column.name)) {
      differences.push({
        kind: "missing-logical-attribute",
        path: `columns.${column.name}`,
        physical: column,
      });
    }
  }

  const physicalForeignKeys = new Map(table.foreignKeys.map((foreignKey) => [foreignKey.name, foreignKey]));
  const mappedForeignKeys = new Set<string>();
  for (const [relationshipName, relationship] of Object.entries(draft.objectType.relationships ?? {})) {
    const mapping = draft.physical.relationships[relationshipName];
    const foreignKeyName = mapping?.foreignKey ?? relationshipName;
    mappedForeignKeys.add(foreignKeyName);
    if (!physicalForeignKeys.has(foreignKeyName)) {
      differences.push({
        kind: "missing-physical-foreign-key",
        path: `relationships.${relationshipName}`,
        logical: relationship,
      });
    }
  }
  for (const foreignKey of table.foreignKeys) {
    if (!mappedForeignKeys.has(foreignKey.name)) {
      differences.push({
        kind: "missing-logical-relationship",
        path: `foreignKeys.${foreignKey.name}`,
        physical: foreignKey,
      });
    }
  }

  const physicalIndexes = new Map(table.indexes.filter((index) => !index.primary).map((index) => [index.name, index]));
  const mappedIndexes = new Set<string>();
  for (const index of draft.objectType.indexes ?? []) {
    const physical = draft.physical.indexes.find((mapping) => mapping.logicalName === index.name);
    const name = physical?.physicalName ?? index.name;
    mappedIndexes.add(name);
    if (!physicalIndexes.has(name)) {
      differences.push({
        kind: "missing-physical-index",
        path: `indexes.${index.name}`,
        logical: index,
      });
    }
  }
  for (const index of physicalIndexes.values()) {
    if (!mappedIndexes.has(index.name)) {
      differences.push({
        kind: "missing-logical-index",
        path: `indexes.${index.name}`,
        physical: index,
      });
    }
  }

  return differences;
}

export function generateSchemaChangePlan(
  table: TableDefinition,
  draft: MetaobjectDraft,
): SchemaChangePlan {
  const differences = compareTableToMetaobject(table, draft);
  const operations: SchemaChangeOperation[] = [];

  for (const difference of differences) {
    const pathName = difference.path.split(".").at(-1) ?? difference.path;
    switch (difference.kind) {
      case "missing-physical-column": {
        const attribute = draft.objectType.attributes[pathName];
        if (!attribute) break;
        const mapping = draft.physical.attributes[pathName];
        operations.push({
          kind: "add-column",
          table: table.name,
          column: mapping?.column ?? pathName,
          logicalType: attribute.type,
          nullable: attribute.nullable ?? !attribute.required,
          destructive: false,
        });
        break;
      }
      case "missing-logical-attribute":
        operations.push({ kind: "drop-column", table: table.name, column: pathName, destructive: true });
        break;
      case "type-mismatch":
      case "nullability-mismatch": {
        const attributeName = difference.path.split(".")[1];
        if (!attributeName) break;
        const attribute = draft.objectType.attributes[attributeName];
        if (!attribute) break;
        const mapping = draft.physical.attributes[attributeName];
        operations.push({
          kind: "alter-column",
          table: table.name,
          column: mapping?.column ?? attributeName,
          logicalType: attribute.type,
          nullable: attribute.nullable ?? !attribute.required,
          destructive: difference.kind === "type-mismatch" || !(attribute.nullable ?? !attribute.required),
        });
        break;
      }
      case "missing-physical-foreign-key": {
        const relationship = draft.physical.relationships[pathName];
        const logical = draft.objectType.relationships?.[pathName];
        if (!relationship || !logical) break;
        operations.push({
          kind: "add-foreign-key",
          table: table.name,
          name: relationship.foreignKey,
          columns: relationship.columns,
          ...(relationship.referencedCatalog !== undefined
            ? { referencedCatalog: relationship.referencedCatalog }
            : {}),
          ...(relationship.referencedSchema !== undefined
            ? { referencedSchema: relationship.referencedSchema }
            : {}),
          referencedTable: relationship.referencedTable,
          referencedColumns: relationship.referencedColumns,
          ...(logical.onTargetDelete !== undefined ? { onDelete: logical.onTargetDelete } : {}),
          destructive: false,
        });
        break;
      }
      case "missing-logical-relationship":
        operations.push({ kind: "drop-foreign-key", table: table.name, name: pathName, destructive: true });
        break;
      case "missing-physical-index": {
        const logical = (draft.objectType.indexes ?? []).find((index) => index.name === pathName);
        if (!logical) break;
        const mapping = draft.physical.indexes.find((index) => index.logicalName === pathName);
        const columns = logical.attributes.map((attribute) =>
          draft.physical.attributes[attribute.attribute]?.column ?? attribute.attribute,
        );
        operations.push({
          kind: "create-index",
          table: table.name,
          name: mapping?.physicalName ?? logical.name,
          unique: logical.unique ?? false,
          columns,
          destructive: false,
        });
        break;
      }
      case "missing-logical-index":
        operations.push({ kind: "drop-index", table: table.name, name: pathName, destructive: true });
        break;
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

function toAttributeDefinition(
  column: ColumnDefinition,
  indexes: readonly IndexDefinition[],
): AttributeDefinition {
  const unique = indexes.some(
    (index) => index.unique && index.columns.length === 1 && index.columns[0]?.name === column.name,
  );
  const required = !column.nullable && column.defaultValue === undefined && !column.autoIncrement && !column.generated;
  return {
    type: logicalTypeForColumn(column),
    ...(required ? { required: true } : {}),
    nullable: column.nullable,
    ...(column.autoIncrement || column.generated ? { readOnly: true } : {}),
    ...(unique ? { unique: true } : {}),
  };
}

function toRelationshipDefinition(
  table: TableDefinition,
  foreignKey: ForeignKeyDefinition,
  options: ReverseEngineeringOptions,
): RelationshipDefinition {
  const sourceColumns = foreignKey.columns
    .map((name) => table.columns.find((column) => column.name === name))
    .filter((column): column is ColumnDefinition => column !== undefined);
  const required = sourceColumns.length === foreignKey.columns.length && sourceColumns.every((column) => !column.nullable);
  return {
    target: objectTypeId(
      {
        catalog: foreignKey.referencedCatalog,
        schema: foreignKey.referencedSchema,
        name: foreignKey.referencedTable,
      },
      options,
    ),
    cardinality: relationshipCardinality(table, foreignKey),
    ...(required ? { required: true } : {}),
    ownership: "none",
    kind: "association",
    onTargetDelete: referentialAction(foreignKey.deleteRule),
  };
}

function relationshipCardinality(
  table: TableDefinition,
  foreignKey: ForeignKeyDefinition,
): RelationshipCardinality {
  const foreignColumns = new Set(foreignKey.columns);
  const unique = table.indexes.some(
    (index) =>
      index.unique &&
      index.columns.length === foreignColumns.size &&
      index.columns.every((column) => foreignColumns.has(column.name)),
  );
  return unique ? "one-to-one" : "many-to-one";
}

function referentialAction(rule: string | undefined): ReferentialAction {
  switch (rule?.trim().toUpperCase()) {
    case "CASCADE":
      return "cascade";
    case "RESTRICT":
    case "NO ACTION":
      return "restrict";
    case "SET NULL":
    case "SET DEFAULT":
    default:
      return "detach";
  }
}

function toMetaobjectIndexes(
  indexes: readonly IndexDefinition[],
  columnToAttribute: ReadonlyMap<string, string>,
): readonly MetaobjectIndexDefinition[] {
  return indexes
    .filter((index) => !index.primary)
    .map((index) => ({
      name: index.name,
      ...(index.unique ? { unique: true } : {}),
      attributes: index.columns
        .map((column) => {
          const attribute = columnToAttribute.get(column.name);
          if (!attribute) return undefined;
          return {
            attribute,
            ...(column.direction !== undefined ? { direction: column.direction } : {}),
          };
        })
        .filter((item): item is { attribute: string; direction?: "asc" | "desc" } => item !== undefined),
    }))
    .filter((index) => index.attributes.length > 0);
}

export function logicalTypeForColumn(column: Pick<ColumnDefinition, "dataType" | "databaseType">): string {
  const dataType = column.dataType.trim().toLowerCase();
  const databaseType = column.databaseType.trim().toLowerCase();
  if (dataType === "uuid") return "uuid";
  if (dataType === "boolean" || dataType === "bool" || /^tinyint\s*\(\s*1\s*\)/.test(databaseType)) return "boolean";
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

function objectTypeId(
  table: Pick<TableDefinition, "catalog" | "schema" | "name">,
  options: ReverseEngineeringOptions,
): string {
  const prefix = options.idPrefix?.trim() || "db";
  const parts = [table.catalog, table.schema, table.name]
    .filter((value): value is string => Boolean(value))
    .map((value) => toIdSegment(value));
  return `${prefix}:${parts.join(".")}`;
}

function physicalNamespace(catalog?: string, schema?: string): string | undefined {
  const value = [catalog, schema].filter(Boolean).join(".");
  return value || undefined;
}

function relationshipName(foreignKey: ForeignKeyDefinition): string {
  const raw = foreignKey.name || foreignKey.referencedTable;
  return toPropertyName(raw.replace(/^fk[_-]?/i, ""));
}

function toPropertyName(value: string): string {
  const words = wordsOf(value);
  if (words.length === 0) return "value";
  return words[0]!.toLowerCase() + words.slice(1).map(capitalize).join("");
}

function toTypeName(value: string): string {
  const words = wordsOf(value);
  return words.length === 0 ? "Object" : words.map(capitalize).join("");
}

function wordsOf(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

function toIdSegment(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function uniqueName(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}${index}`)) index += 1;
  return `${base}${index}`;
}

import type { TableDefinition } from "@nublox/workbench-catalog";
import {
  compareTableToMetaobject,
  generateSchemaChangePlan,
  reverseEngineerTable,
  type MetaobjectDraft,
  type SchemaDifference,
  type SchemaChangePlan,
} from "@nublox/workbench-metaobject-bridge";
import {
  previewWithProvider,
  toProviderMigrationPlan,
} from "@nublox/workbench-metaobject-bridge/provider-handoff";
import type {
  DatabaseMigrationPreview,
  DatabaseMigrationProvider,
  DatabaseSchemaChangePlan,
} from "@nublox/workbench-provider-api";

export interface SchemaAttributeDraft {
  readonly name: string;
  readonly physicalColumn: string;
  readonly type: string;
  readonly databaseType?: string;
  readonly required: boolean;
  readonly nullable: boolean;
  readonly readOnly: boolean;
  readonly unique: boolean;
}

export interface SchemaRelationshipDraft {
  readonly name: string;
  readonly physicalForeignKey: string;
  readonly target: string;
  readonly cardinality: string;
  readonly required: boolean;
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly onTargetDelete?: string;
}

export interface SchemaIndexDraft {
  readonly name: string;
  readonly physicalName: string;
  readonly unique: boolean;
  readonly attributes: readonly string[];
  readonly columns: readonly string[];
}

export interface SchemaDraftView {
  readonly objectTypeId: string;
  readonly logicalName: string;
  readonly catalog?: string;
  readonly schema?: string;
  readonly table: string;
  readonly kind: "table" | "view";
  readonly attributes: readonly SchemaAttributeDraft[];
  readonly relationships: readonly SchemaRelationshipDraft[];
  readonly indexes: readonly SchemaIndexDraft[];
  readonly primaryKey: readonly string[];
}

export interface SchemaDraftInput extends SchemaDraftView {}

export interface SchemaPreview {
  readonly draft: SchemaDraftView;
  readonly differences: readonly SchemaDifference[];
  readonly neutralPlan: SchemaChangePlan;
  readonly providerPlan: DatabaseSchemaChangePlan;
  readonly providerPreview: DatabaseMigrationPreview;
}

export interface DependencyNode {
  readonly id: string;
  readonly label: string;
  readonly kind: "table" | "view";
  readonly external: boolean;
}

export interface DependencyEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly relationship: string;
  readonly foreignKey: string;
}

export interface DependencyGraph {
  readonly nodes: readonly DependencyNode[];
  readonly edges: readonly DependencyEdge[];
}

export function createSchemaDraft(table: TableDefinition): SchemaDraftView {
  return draftToView(reverseEngineerTable(table));
}

export function previewSchemaDraft(
  table: TableDefinition,
  input: SchemaDraftInput,
  provider: DatabaseMigrationProvider,
): SchemaPreview {
  const baseline = reverseEngineerTable(table);
  const draft = applyDraftView(baseline, input);
  const differences = compareTableToMetaobject(table, draft);
  const neutralPlan = generateSchemaChangePlan(table, draft);
  const providerPlan = toProviderMigrationPlan(neutralPlan, draft);
  const providerPreview = previewWithProvider(neutralPlan, draft, provider);
  return {
    draft: draftToView(draft),
    differences,
    neutralPlan,
    providerPlan,
    providerPreview,
  };
}

export function dependencyGraph(
  tables: readonly TableDefinition[],
): DependencyGraph {
  const nodes = new Map<string, DependencyNode>();
  const edges: DependencyEdge[] = [];

  for (const table of tables) {
    const id = objectId(table.catalog, table.schema, table.name);
    nodes.set(id, {
      id,
      label: qualified(table.catalog, table.schema, table.name),
      kind: table.kind,
      external: false,
    });
  }

  for (const table of tables) {
    const from = objectId(table.catalog, table.schema, table.name);
    for (const fk of table.foreignKeys) {
      const to = objectId(fk.referencedCatalog, fk.referencedSchema, fk.referencedTable);
      if (!nodes.has(to)) {
        nodes.set(to, {
          id: to,
          label: qualified(fk.referencedCatalog, fk.referencedSchema, fk.referencedTable),
          kind: "table",
          external: true,
        });
      }
      edges.push({
        id: `${from}:${fk.name}`,
        from,
        to,
        relationship: fk.name,
        foreignKey: fk.name,
      });
    }
  }

  return { nodes: [...nodes.values()], edges };
}

export function draftToView(draft: MetaobjectDraft): SchemaDraftView {
  const attributes: SchemaAttributeDraft[] = [];
  for (const [name, definition] of Object.entries(draft.objectType.attributes)) {
    const physical = draft.physical.attributes[name];
    attributes.push({
      name,
      physicalColumn: physical?.column ?? name,
      type: definition.type,
      ...(physical?.databaseType ? { databaseType: physical.databaseType } : {}),
      required: definition.required ?? false,
      nullable: definition.nullable ?? !definition.required,
      readOnly: definition.readOnly ?? false,
      unique: definition.unique ?? false,
    });
  }

  const relationships: SchemaRelationshipDraft[] = [];
  for (const [name, definition] of Object.entries(draft.objectType.relationships ?? {})) {
    const physical = draft.physical.relationships[name];
    relationships.push({
      name,
      physicalForeignKey: physical?.foreignKey ?? name,
      target: definition.target,
      cardinality: definition.cardinality,
      required: definition.required ?? false,
      columns: physical?.columns ?? [],
      referencedTable: physical?.referencedTable ?? definition.target,
      referencedColumns: physical?.referencedColumns ?? [],
      ...(definition.onTargetDelete ? { onTargetDelete: definition.onTargetDelete } : {}),
    });
  }

  const indexes: SchemaIndexDraft[] = (draft.objectType.indexes ?? []).map((index) => {
    const physical = draft.physical.indexes.find((item) => item.logicalName === index.name);
    return {
      name: index.name,
      physicalName: physical?.physicalName ?? index.name,
      unique: index.unique ?? false,
      attributes: index.attributes.map((item) => item.attribute),
      columns: physical?.columns ?? index.attributes.map((item) => draft.physical.attributes[item.attribute]?.column ?? item.attribute),
    };
  });

  return {
    objectTypeId: draft.objectType.id,
    logicalName: draft.objectType.name,
    ...(draft.physical.catalog !== undefined ? { catalog: draft.physical.catalog } : {}),
    ...(draft.physical.schema !== undefined ? { schema: draft.physical.schema } : {}),
    table: draft.physical.table,
    kind: draft.physical.providerNeutralKind,
    attributes,
    relationships,
    indexes,
    primaryKey: draft.physical.primaryKey,
  };
}

function applyDraftView(baseline: MetaobjectDraft, input: SchemaDraftInput): MetaobjectDraft {
  if (baseline.physical.table !== input.table) {
    throw new Error(`Schema draft table '${input.table}' does not match live table '${baseline.physical.table}'.`);
  }
  const attributes: Record<string, typeof baseline.objectType.attributes[string]> = {};
  const physicalAttributes: Record<string, typeof baseline.physical.attributes[string]> = {};
  const names = new Set<string>();

  for (const attribute of input.attributes) {
    const name = requireName(attribute.name, "Attribute name");
    if (names.has(name)) throw new Error(`Duplicate schema attribute '${name}'.`);
    names.add(name);
    const column = requireName(attribute.physicalColumn, `Physical column for '${name}'`);
    attributes[name] = {
      type: requireName(attribute.type, `Type for '${name}'`),
      ...(attribute.required ? { required: true } : {}),
      nullable: attribute.nullable,
      ...(attribute.readOnly ? { readOnly: true } : {}),
      ...(attribute.unique ? { unique: true } : {}),
    };
    const existing = Object.values(baseline.physical.attributes).find((value) => value.column === column);
    physicalAttributes[name] = existing
      ? { ...existing, attribute: name, ...(attribute.databaseType ? { databaseType: attribute.databaseType } : {}) }
      : {
          attribute: name,
          column,
          ordinal: baseline.physical.attributes[name]?.ordinal ?? input.attributes.indexOf(attribute) + 1,
          dataType: attribute.type,
          databaseType: attribute.databaseType ?? "",
          nullable: attribute.nullable,
          autoIncrement: false,
          generated: false,
        };
  }

  return {
    objectType: {
      ...baseline.objectType,
      name: requireName(input.logicalName, "Logical object name"),
      attributes,
    },
    physical: {
      ...baseline.physical,
      attributes: physicalAttributes,
    },
  };
}

function requireName(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} cannot be empty.`);
  return result;
}

function objectId(catalog: string | undefined, schema: string | undefined, name: string): string {
  return [catalog ?? "", schema ?? "", name].join("\u001f");
}

function qualified(catalog: string | undefined, schema: string | undefined, name: string): string {
  return [catalog, schema, name].filter(Boolean).join(".");
}

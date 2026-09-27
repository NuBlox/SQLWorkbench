import type {
  DatabaseMigrationPreview,
  DatabaseMigrationProvider,
  DatabaseSchemaChangeOperation,
  DatabaseSchemaChangePlan,
} from "@nublox/workbench-provider-api";

import type {
  MetaobjectDraft,
  SchemaChangeOperation,
  SchemaChangePlan,
} from "./index.js";

/**
 * Convert the bridge's neutral plan to the provider contract, enriching column
 * operations with retained physical database types where the mapping has one.
 */
export function toProviderMigrationPlan(
  plan: SchemaChangePlan,
  draft: MetaobjectDraft,
): DatabaseSchemaChangePlan {
  return {
    source: plan.source,
    ...(plan.catalog !== undefined ? { catalog: plan.catalog } : {}),
    ...(plan.schema !== undefined ? { schema: plan.schema } : {}),
    table: plan.table,
    operations: plan.operations.map((operation) => enrichOperation(operation, draft)),
    destructive: plan.destructive,
  };
}

export function previewWithProvider(
  plan: SchemaChangePlan,
  draft: MetaobjectDraft,
  provider: DatabaseMigrationProvider,
): DatabaseMigrationPreview {
  return provider.preview(toProviderMigrationPlan(plan, draft));
}

function enrichOperation(
  operation: SchemaChangeOperation,
  draft: MetaobjectDraft,
): DatabaseSchemaChangeOperation {
  if (operation.kind !== "add-column" && operation.kind !== "alter-column") {
    return operation;
  }

  const mapping = Object.values(draft.physical.attributes).find(
    (attribute) => attribute.column === operation.column,
  );
  return {
    ...operation,
    ...(mapping?.databaseType ? { databaseType: mapping.databaseType } : {}),
  };
}

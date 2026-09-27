import { createHash } from "node:crypto";

import type { SchemaPreviewRequest } from "../lib/desktop-api.js";
import type { TableDefinition } from "@nublox/workbench-catalog";
import type { SchemaPreview } from "@nublox/workbench-schema-engineering";

export const NON_DESTRUCTIVE_CONFIRMATION = "APPLY SCHEMA CHANGES";
export const DESTRUCTIVE_CONFIRMATION = "APPLY DESTRUCTIVE CHANGES";

export function schemaExecutionFingerprint(
  request: SchemaPreviewRequest,
  liveTable: TableDefinition,
  preview: SchemaPreview,
): string {
  const payload = JSON.stringify({
    connectionId: request.connectionId,
    catalog: request.catalog ?? null,
    schema: request.schema ?? null,
    name: request.name,
    liveTable,
    draft: request.draft,
    statements: preview.providerPreview.statements,
    destructive: preview.neutralPlan.destructive,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function requiredSchemaConfirmation(destructive: boolean): string {
  return destructive ? DESTRUCTIVE_CONFIRMATION : NON_DESTRUCTIVE_CONFIRMATION;
}

export function assertSchemaExecutionGuard(
  expectedFingerprint: string,
  suppliedFingerprint: string,
  destructive: boolean,
  confirmation: string,
): void {
  if (suppliedFingerprint !== expectedFingerprint) {
    throw new Error("Schema preview is stale. Generate a new preview from the current live schema before execution.");
  }
  const required = requiredSchemaConfirmation(destructive);
  if (confirmation.trim() !== required) {
    throw new Error(`Schema execution requires the exact confirmation phrase '${required}'.`);
  }
}

import { createHash } from "node:crypto";

import type {
  DatabaseMigrationPreview,
  DatabaseViewChangePlan,
  DatabaseViewDefinition,
} from "@nublox/workbench-provider-api";

export const VIEW_CONFIRMATION = "APPLY VIEW CHANGES";

export function viewExecutionFingerprint(
  connectionId: string,
  live: DatabaseViewDefinition,
  draft: DatabaseViewChangePlan,
  preview: DatabaseMigrationPreview,
): string {
  const payload = JSON.stringify({
    connectionId,
    live,
    draft,
    statements: preview.statements,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function assertViewExecutionGuard(
  expectedFingerprint: string,
  suppliedFingerprint: string,
  confirmation: string,
): void {
  if (expectedFingerprint !== suppliedFingerprint) {
    throw new Error("View preview is stale. Generate a new preview from the current live view before execution.");
  }
  if (confirmation.trim() !== VIEW_CONFIRMATION) {
    throw new Error(`View execution requires the exact confirmation phrase '${VIEW_CONFIRMATION}'.`);
  }
}

import { createHash } from "node:crypto";

import type { ExplorerRelationDetails } from "@nublox/workbench-core";
import type {
  DatabaseMigrationPreview,
  DatabaseSchemaChangePlan,
} from "@nublox/workbench-provider-api";

export const ER_CONFIRMATION = "APPLY ER CHANGES";
export const ER_DESTRUCTIVE_CONFIRMATION = "APPLY DESTRUCTIVE ER CHANGES";

export function erExecutionFingerprint(
  connectionId: string,
  liveSource: ExplorerRelationDetails,
  liveTarget: ExplorerRelationDetails | undefined,
  plan: DatabaseSchemaChangePlan,
  preview: DatabaseMigrationPreview,
): string {
  return createHash("sha256").update(JSON.stringify({
    connectionId,
    liveSource,
    liveTarget: liveTarget ?? null,
    plan,
    statements: preview.statements,
  })).digest("hex");
}

export function requiredErConfirmation(destructive: boolean): string {
  return destructive ? ER_DESTRUCTIVE_CONFIRMATION : ER_CONFIRMATION;
}

export function assertErExecutionGuard(
  expectedFingerprint: string,
  suppliedFingerprint: string,
  destructive: boolean,
  confirmation: string,
): void {
  if (expectedFingerprint !== suppliedFingerprint) {
    throw new Error("ER migration preview is stale. Generate a new preview from current live metadata before execution.");
  }
  const required = requiredErConfirmation(destructive);
  if (confirmation.trim() !== required) {
    throw new Error(`ER execution requires the exact confirmation phrase '${required}'.`);
  }
}

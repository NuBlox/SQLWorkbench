import {
  DatabaseExplorerService,
  QueryService,
  type ConnectionManager,
  type ExplorerRelationDetails,
} from "@nublox/workbench-core";
import type {
  DatabaseMigrationPreview,
  DatabaseReferentialAction,
  DatabaseSchemaChangePlan,
} from "@nublox/workbench-provider-api";

import type {
  ErAddRelationshipRequest,
  ErDropRelationshipRequest,
  ErExecuteRequest,
  ErExecutionResult,
  ErPreparedPreview,
  ErRelationshipRequest,
} from "../lib/desktop-api.js";
import {
  assertErExecutionGuard,
  erExecutionFingerprint,
  requiredErConfirmation,
} from "./er-execution-guard.js";

export class DesktopErService {
  readonly #explorer: DatabaseExplorerService;
  readonly #queries: QueryService;

  constructor(readonly connections: ConnectionManager) {
    this.#explorer = new DatabaseExplorerService(connections);
    this.#queries = new QueryService(connections);
  }

  async preview(request: ErRelationshipRequest): Promise<ErPreparedPreview> {
    const prepared = await this.#prepare(request);
    return {
      plan: prepared.plan,
      preview: prepared.preview,
      guard: {
        fingerprint: erExecutionFingerprint(request.connectionId, prepared.source, prepared.target, prepared.plan, prepared.preview),
        destructive: prepared.plan.destructive,
        confirmationPhrase: requiredErConfirmation(prepared.plan.destructive),
      },
    };
  }

  async execute(request: ErExecuteRequest): Promise<ErExecutionResult> {
    const prepared = await this.#prepare(request);
    const fingerprint = erExecutionFingerprint(request.connectionId, prepared.source, prepared.target, prepared.plan, prepared.preview);
    assertErExecutionGuard(fingerprint, request.fingerprint, prepared.plan.destructive, request.confirmation);

    let executedStatements = 0;
    const statements = prepared.preview.statements;
    for (let index = 0; index < statements.length; index += 1) {
      try {
        await this.#queries.execute(request.connectionId, { sql: statements[index]!, mode: "text" });
        executedStatements += 1;
      } catch (error) {
        return {
          completed: false,
          executedStatements,
          totalStatements: statements.length,
          failedStatementIndex: index,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
    return { completed: true, executedStatements, totalStatements: statements.length };
  }

  async #prepare(request: ErRelationshipRequest): Promise<{
    source: ExplorerRelationDetails;
    target?: ExplorerRelationDetails;
    plan: DatabaseSchemaChangePlan;
    preview: DatabaseMigrationPreview;
  }> {
    const source = await this.#describe(request, request.sourceTable);
    requireTable(source, "Source");
    const connection = this.connections.get(request.connectionId);
    const migrations = connection.provider.migrations;
    if (!migrations) throw new Error(`Database provider '${connection.provider.id}' does not support schema migration previews.`);

    if (request.operation === "drop") {
      const plan = dropPlan(request, source);
      return { source, plan, preview: migrations.preview(plan) };
    }

    const target = await this.#describe(request, request.targetTable);
    requireTable(target, "Target");
    const plan = addPlan(request, source, target);
    return { source, target, plan, preview: migrations.preview(plan) };
  }

  #describe(request: ErRelationshipRequest, name: string): Promise<ExplorerRelationDetails> {
    return this.#explorer.describeRelation({
      connectionId: request.connectionId,
      ...(request.catalog ? { catalog: request.catalog } : {}),
      ...(request.schema ? { schema: request.schema } : {}),
      name,
      includeSystem: request.includeSystem ?? false,
    });
  }
}

function addPlan(
  request: ErAddRelationshipRequest,
  source: ExplorerRelationDetails,
  target: ExplorerRelationDetails,
): DatabaseSchemaChangePlan {
  const foreignKey = requireName(request.foreignKey, "Foreign key name");
  if (source.foreignKeys.some((item) => item.name === foreignKey)) {
    throw new Error(`Foreign key '${foreignKey}' already exists on '${source.relation.name}'.`);
  }
  const sourceColumns = uniqueColumns(request.sourceColumns, "Source columns");
  const targetColumns = uniqueColumns(request.targetColumns, "Target columns");
  if (sourceColumns.length !== targetColumns.length) throw new Error("Source and target relationship column counts must match.");
  validateColumns(source, sourceColumns, "source");
  validateColumns(target, targetColumns, "target");

  return {
    source: "er-designer",
    ...(request.catalog ? { catalog: request.catalog } : {}),
    ...(request.schema ? { schema: request.schema } : {}),
    table: source.relation.name,
    operations: [{
      kind: "add-foreign-key",
      table: source.relation.name,
      name: foreignKey,
      columns: sourceColumns,
      ...(request.catalog ? { referencedCatalog: request.catalog } : {}),
      ...(request.schema ? { referencedSchema: request.schema } : {}),
      referencedTable: target.relation.name,
      referencedColumns: targetColumns,
      ...(request.onDelete ? { onDelete: request.onDelete as DatabaseReferentialAction } : {}),
      destructive: false,
    }],
    destructive: false,
  };
}

function dropPlan(request: ErDropRelationshipRequest, source: ExplorerRelationDetails): DatabaseSchemaChangePlan {
  const foreignKey = requireName(request.foreignKey, "Foreign key name");
  if (!source.foreignKeys.some((item) => item.name === foreignKey)) {
    throw new Error(`Foreign key '${foreignKey}' does not exist on '${source.relation.name}'.`);
  }
  return {
    source: "er-designer",
    ...(request.catalog ? { catalog: request.catalog } : {}),
    ...(request.schema ? { schema: request.schema } : {}),
    table: source.relation.name,
    operations: [{ kind: "drop-foreign-key", table: source.relation.name, name: foreignKey, destructive: true }],
    destructive: true,
  };
}

function requireTable(details: ExplorerRelationDetails, label: string): void {
  if (details.relation.kind !== "table") throw new Error(`${label} ER relationship object must be a table.`);
}

function validateColumns(details: ExplorerRelationDetails, columns: readonly string[], label: string): void {
  const available = new Set(details.columns.map((item) => item.name));
  for (const column of columns) if (!available.has(column)) throw new Error(`Unknown ${label} column '${column}' on '${details.relation.name}'.`);
}

function uniqueColumns(values: readonly string[], label: string): readonly string[] {
  const result = values.map((item) => requireName(item, label));
  if (result.length === 0) throw new Error(`${label} cannot be empty.`);
  if (new Set(result).size !== result.length) throw new Error(`${label} cannot contain duplicate columns.`);
  return result;
}

function requireName(value: string, label: string): string {
  const result = value.trim();
  if (!result) throw new Error(`${label} cannot be empty.`);
  return result;
}

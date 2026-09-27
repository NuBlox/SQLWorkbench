import type { TableDefinition } from "@nublox/workbench-catalog";
import {
  DatabaseExplorerService,
  QueryService,
  type ConnectionManager,
} from "@nublox/workbench-core";
import {
  createSchemaDraft,
  dependencyGraph,
  previewSchemaDraft,
  type DependencyGraph,
  type SchemaDraftView,
  type SchemaPreview,
} from "@nublox/workbench-schema-engineering";

import type {
  SchemaExecuteRequest,
  SchemaExecutionResult,
  SchemaGraphRequest,
  SchemaLoadRequest,
  SchemaPreparedPreview,
  SchemaPreviewRequest,
} from "../lib/desktop-api.js";
import {
  assertSchemaExecutionGuard,
  requiredSchemaConfirmation,
  schemaExecutionFingerprint,
} from "./schema-execution-guard.js";

export class DesktopSchemaService {
  readonly #explorer: DatabaseExplorerService;
  readonly #queries: QueryService;

  constructor(readonly connections: ConnectionManager) {
    this.#explorer = new DatabaseExplorerService(connections);
    this.#queries = new QueryService(connections);
  }

  async load(request: SchemaLoadRequest): Promise<SchemaDraftView> {
    const table = await this.#liveTable(request);
    return createSchemaDraft(table);
  }

  async preview(request: SchemaPreviewRequest): Promise<SchemaPreparedPreview> {
    const { table, preview } = await this.#prepare(request);
    return {
      preview,
      guard: {
        fingerprint: schemaExecutionFingerprint(request, table, preview),
        destructive: preview.neutralPlan.destructive,
        confirmationPhrase: requiredSchemaConfirmation(preview.neutralPlan.destructive),
      },
    };
  }

  async graph(request: SchemaGraphRequest): Promise<DependencyGraph> {
    const relations = await this.#explorer.listRelations(request);
    const tables = await Promise.all(relations.map(async (relation) => {
      const details = await this.#explorer.describeRelation({
        connectionId: request.connectionId,
        ...(relation.catalog !== undefined ? { catalog: relation.catalog } : {}),
        ...(relation.schema !== undefined ? { schema: relation.schema } : {}),
        name: relation.name,
        includeSystem: request.includeSystem ?? false,
      });
      return toTableDefinition(details);
    }));
    return dependencyGraph(tables);
  }

  async execute(request: SchemaExecuteRequest): Promise<SchemaExecutionResult> {
    const { table, preview } = await this.#prepare(request);
    const fingerprint = schemaExecutionFingerprint(request, table, preview);
    assertSchemaExecutionGuard(
      fingerprint,
      request.fingerprint,
      preview.neutralPlan.destructive,
      request.confirmation,
    );

    const statements = preview.providerPreview.statements;
    if (statements.length === 0) {
      return {
        completed: true,
        executedStatements: 0,
        totalStatements: 0,
        refreshedDraft: createSchemaDraft(table),
      };
    }

    let executedStatements = 0;
    for (let index = 0; index < statements.length; index += 1) {
      try {
        await this.#queries.execute(request.connectionId, {
          sql: statements[index]!,
          mode: "text",
        });
        executedStatements += 1;
      } catch (error) {
        return {
          completed: false,
          executedStatements,
          totalStatements: statements.length,
          failedStatementIndex: index,
          error: error instanceof Error ? error.message : String(error),
          ...(await this.#safeReload(request)),
        };
      }
    }

    return {
      completed: true,
      executedStatements,
      totalStatements: statements.length,
      ...(await this.#safeReload(request)),
    };
  }

  async #prepare(request: SchemaPreviewRequest): Promise<{ table: TableDefinition; preview: SchemaPreview }> {
    const table = await this.#liveTable(request);
    const connection = this.connections.get(request.connectionId);
    const migrations = connection.provider.migrations;
    if (!migrations) {
      throw new Error(`Database provider '${connection.provider.id}' does not provide schema migration previews.`);
    }
    return {
      table,
      preview: previewSchemaDraft(table, request.draft, migrations),
    };
  }

  async #safeReload(request: SchemaLoadRequest): Promise<{ refreshedDraft?: SchemaDraftView }> {
    try {
      return { refreshedDraft: await this.load(request) };
    } catch {
      return {};
    }
  }

  async #liveTable(request: SchemaLoadRequest): Promise<TableDefinition> {
    const details = await this.#explorer.describeRelation(request);
    return toTableDefinition(details);
  }
}

function toTableDefinition(details: Awaited<ReturnType<DatabaseExplorerService["describeRelation"]>>): TableDefinition {
  return {
    ...(details.relation.catalog !== undefined ? { catalog: details.relation.catalog } : {}),
    ...(details.relation.schema !== undefined ? { schema: details.relation.schema } : {}),
    name: details.relation.name,
    kind: details.relation.kind,
    ...(details.relation.engine !== undefined ? { engine: details.relation.engine } : {}),
    ...(details.relation.estimatedRows !== undefined ? { estimatedRows: details.relation.estimatedRows } : {}),
    ...(details.relation.comment !== undefined ? { comment: details.relation.comment } : {}),
    columns: details.columns,
    indexes: details.indexes,
    foreignKeys: details.foreignKeys,
  };
}

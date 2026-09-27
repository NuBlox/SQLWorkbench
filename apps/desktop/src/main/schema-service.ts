import type { TableDefinition } from "@nublox/workbench-catalog";
import { DatabaseExplorerService, type ConnectionManager } from "@nublox/workbench-core";
import { mysqlMigrationProvider } from "@nublox/workbench-provider-mysql/migration";
import {
  createSchemaDraft,
  previewSchemaDraft,
  type SchemaDraftView,
  type SchemaPreview,
} from "@nublox/workbench-schema-engineering";

import type {
  SchemaLoadRequest,
  SchemaPreviewRequest,
} from "../lib/desktop-api.js";

export class DesktopSchemaService {
  readonly #explorer: DatabaseExplorerService;

  constructor(readonly connections: ConnectionManager) {
    this.#explorer = new DatabaseExplorerService(connections);
  }

  async load(request: SchemaLoadRequest): Promise<SchemaDraftView> {
    const table = await this.#liveTable(request);
    return createSchemaDraft(table);
  }

  async preview(request: SchemaPreviewRequest): Promise<SchemaPreview> {
    const table = await this.#liveTable(request);
    const connection = this.connections.get(request.connectionId);
    if (connection.provider.id !== "mysql") {
      throw new Error(`Database provider '${connection.provider.id}' does not yet provide schema migration previews.`);
    }
    return previewSchemaDraft(table, request.draft, mysqlMigrationProvider);
  }

  async #liveTable(request: SchemaLoadRequest): Promise<TableDefinition> {
    const details = await this.#explorer.describeRelation(request);
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
}

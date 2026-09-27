import { QueryService, type ConnectionManager } from "@nublox/workbench-core";
import type {
  QueryCompletionCatalog,
  QueryCatalogNamespace,
} from "@nublox/workbench-query-engineering";

export class DesktopQueryLanguageService {
  readonly #queries: QueryService;

  constructor(readonly connections: ConnectionManager) {
    this.#queries = new QueryService(connections);
  }

  async catalog(connectionId: string): Promise<QueryCompletionCatalog> {
    const connection = this.connections.get(connectionId);
    const catalog = await this.#queries.introspect(connectionId, {
      includeSystem: false,
      depth: "full",
    });

    return {
      providerId: connection.provider.id,
      capturedAt: catalog.capturedAt,
      namespaces: catalog.namespaces.map((namespace): QueryCatalogNamespace => ({
        ...(namespace.catalog !== undefined ? { catalog: namespace.catalog } : {}),
        ...(namespace.schema !== undefined ? { schema: namespace.schema } : {}),
        label: namespaceLabel(namespace.catalog, namespace.schema),
        relations: namespace.tables.map((table) => ({
          ...(table.catalog !== undefined ? { catalog: table.catalog } : {}),
          ...(table.schema !== undefined ? { schema: table.schema } : {}),
          name: table.name,
          kind: table.kind,
          columns: table.columns.map((column) => ({
            name: column.name,
            dataType: column.dataType,
            databaseType: column.databaseType,
          })),
        })),
      })),
    };
  }
}

function namespaceLabel(catalog?: string, schema?: string): string {
  const parts = [catalog, schema].filter((value): value is string => Boolean(value));
  return parts.join(".") || "default";
}

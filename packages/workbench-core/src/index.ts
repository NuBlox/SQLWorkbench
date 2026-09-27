import type {
  DatabaseConnectionConfig,
  DatabaseProvider,
  DatabaseSession,
  ExplainPlan,
  IntrospectionOptions,
  QueryExecution,
  QueryRequest,
} from "@nublox/workbench-provider-api";
import type {
  ColumnDefinition,
  DatabaseCatalog,
  DatabaseNamespace,
  ForeignKeyDefinition,
  IndexDefinition,
  TableDefinition,
} from "@nublox/workbench-catalog";

export class ProviderRegistry {
  readonly #providers = new Map<string, DatabaseProvider>();

  register(provider: DatabaseProvider): void {
    const id = normalizeProviderId(provider.id);
    if (this.#providers.has(id)) {
      throw new Error(`Database provider '${provider.id}' is already registered.`);
    }
    this.#providers.set(id, provider);
  }

  get(providerId: string): DatabaseProvider {
    const provider = this.#providers.get(normalizeProviderId(providerId));
    if (!provider) {
      throw new Error(`Database provider '${providerId}' is not registered.`);
    }
    return provider;
  }

  list(): readonly DatabaseProvider[] {
    return [...this.#providers.values()];
  }
}

export interface WorkbenchConnection {
  readonly id: string;
  readonly provider: DatabaseProvider;
  readonly session: DatabaseSession;
}

export class ConnectionManager {
  readonly #connections = new Map<string, WorkbenchConnection>();

  constructor(readonly providers: ProviderRegistry) {}

  async connect(id: string, config: DatabaseConnectionConfig): Promise<WorkbenchConnection> {
    if (this.#connections.has(id)) {
      throw new Error(`Connection '${id}' is already open.`);
    }

    const provider = this.providers.get(config.providerId);
    const session = await provider.connect(config);
    const connection = { id, provider, session } satisfies WorkbenchConnection;
    this.#connections.set(id, connection);
    return connection;
  }

  get(id: string): WorkbenchConnection {
    const connection = this.#connections.get(id);
    if (!connection) {
      throw new Error(`Connection '${id}' is not open.`);
    }
    return connection;
  }

  list(): readonly WorkbenchConnection[] {
    return [...this.#connections.values()];
  }

  async disconnect(id: string): Promise<void> {
    const connection = this.get(id);
    this.#connections.delete(id);
    await connection.session.close();
  }

  async disconnectAll(): Promise<void> {
    const connections = [...this.#connections.values()];
    this.#connections.clear();
    const results = await Promise.allSettled(connections.map(({ session }) => session.close()));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) {
      throw failure.reason;
    }
  }
}

export class QueryService {
  constructor(readonly connections: ConnectionManager) {}

  execute(connectionId: string, request: QueryRequest): Promise<QueryExecution> {
    const { provider, session } = this.connections.get(connectionId);
    return provider.execute(session, request);
  }

  explain(connectionId: string, request: QueryRequest): Promise<ExplainPlan> {
    const { provider, session } = this.connections.get(connectionId);
    return provider.explain(session, request);
  }

  introspect(connectionId: string, options?: IntrospectionOptions): Promise<DatabaseCatalog> {
    const { provider, session } = this.connections.get(connectionId);
    return provider.introspect(session, options);
  }
}

export interface ExplorerNamespace {
  readonly key: string;
  readonly catalog?: string;
  readonly schema?: string;
  readonly label: string;
  readonly system: boolean;
  readonly defaultCharacterSet?: string;
  readonly defaultCollation?: string;
}

export interface ExplorerRelation {
  readonly key: string;
  readonly catalog?: string;
  readonly schema?: string;
  readonly name: string;
  readonly kind: "table" | "view";
  readonly engine?: string;
  readonly estimatedRows?: number;
  readonly comment?: string;
}

export interface ExplorerRelationDetails {
  readonly relation: ExplorerRelation;
  readonly columns: readonly ColumnDefinition[];
  readonly indexes: readonly IndexDefinition[];
  readonly foreignKeys: readonly ForeignKeyDefinition[];
}

export interface ExplorerNamespaceRequest {
  readonly connectionId: string;
  readonly includeSystem?: boolean;
}

export interface ExplorerRelationRequest {
  readonly connectionId: string;
  readonly catalog?: string;
  readonly schema?: string;
  readonly includeSystem?: boolean;
}

export interface ExplorerRelationDetailsRequest extends ExplorerRelationRequest {
  readonly name: string;
}

export class DatabaseExplorerService {
  readonly #queries: QueryService;

  constructor(readonly connections: ConnectionManager) {
    this.#queries = new QueryService(connections);
  }

  async listNamespaces(request: ExplorerNamespaceRequest): Promise<readonly ExplorerNamespace[]> {
    this.#requireIntrospection(request.connectionId);
    const catalog = await this.#queries.introspect(request.connectionId, {
      includeSystem: request.includeSystem ?? false,
      depth: "namespaces",
    });
    return catalog.namespaces.map(toExplorerNamespace);
  }

  async listRelations(request: ExplorerRelationRequest): Promise<readonly ExplorerRelation[]> {
    this.#requireIntrospection(request.connectionId);
    const catalog = await this.#queries.introspect(request.connectionId, {
      includeSystem: request.includeSystem ?? false,
      depth: "relations",
      ...(request.catalog ? { catalogs: [request.catalog] } : {}),
    });
    const namespace = findNamespace(catalog, request.catalog, request.schema);
    return namespace.tables.map(toExplorerRelation);
  }

  async describeRelation(request: ExplorerRelationDetailsRequest): Promise<ExplorerRelationDetails> {
    this.#requireIntrospection(request.connectionId);
    const name = request.name.trim();
    if (!name) throw new Error("Relation name cannot be empty.");

    const catalog = await this.#queries.introspect(request.connectionId, {
      includeSystem: request.includeSystem ?? false,
      depth: "full",
      ...(request.catalog ? { catalogs: [request.catalog] } : {}),
    });
    const namespace = findNamespace(catalog, request.catalog, request.schema);
    const relation = namespace.tables.find((table) => table.name === name);
    if (!relation) {
      throw new Error(`Relation '${qualifiedLabel(request.catalog, request.schema, name)}' was not found.`);
    }

    return {
      relation: toExplorerRelation(relation),
      columns: relation.columns,
      indexes: relation.indexes,
      foreignKeys: relation.foreignKeys,
    };
  }

  #requireIntrospection(connectionId: string): void {
    const { provider } = this.connections.get(connectionId);
    if (!provider.capabilities.catalogIntrospection) {
      throw new Error(`Database provider '${provider.id}' does not support catalogue introspection.`);
    }
  }
}

function findNamespace(
  catalog: DatabaseCatalog,
  requestedCatalog?: string,
  requestedSchema?: string,
): DatabaseNamespace {
  const namespace = catalog.namespaces.find((candidate) =>
    (requestedCatalog === undefined || candidate.catalog === requestedCatalog)
    && (requestedSchema === undefined || candidate.schema === requestedSchema));
  if (!namespace) {
    throw new Error(`Namespace '${qualifiedLabel(requestedCatalog, requestedSchema)}' was not found.`);
  }
  return namespace;
}

function toExplorerNamespace(namespace: DatabaseNamespace): ExplorerNamespace {
  return {
    key: namespaceKey(namespace.catalog, namespace.schema),
    ...(namespace.catalog ? { catalog: namespace.catalog } : {}),
    ...(namespace.schema ? { schema: namespace.schema } : {}),
    label: qualifiedLabel(namespace.catalog, namespace.schema),
    system: namespace.system,
    ...(namespace.defaultCharacterSet ? { defaultCharacterSet: namespace.defaultCharacterSet } : {}),
    ...(namespace.defaultCollation ? { defaultCollation: namespace.defaultCollation } : {}),
  };
}

function toExplorerRelation(table: TableDefinition): ExplorerRelation {
  return {
    key: `${namespaceKey(table.catalog, table.schema)}\u001f${table.name}`,
    ...(table.catalog ? { catalog: table.catalog } : {}),
    ...(table.schema ? { schema: table.schema } : {}),
    name: table.name,
    kind: table.kind,
    ...(table.engine ? { engine: table.engine } : {}),
    ...(table.estimatedRows !== undefined ? { estimatedRows: table.estimatedRows } : {}),
    ...(table.comment ? { comment: table.comment } : {}),
  };
}

function namespaceKey(catalog?: string, schema?: string): string {
  return `${catalog ?? ""}\u001f${schema ?? ""}`;
}

function qualifiedLabel(catalog?: string, schema?: string, name?: string): string {
  const parts = [catalog, schema, name].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(".") : "default";
}

function normalizeProviderId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!id) {
    throw new Error("Database provider id cannot be empty.");
  }
  return id;
}

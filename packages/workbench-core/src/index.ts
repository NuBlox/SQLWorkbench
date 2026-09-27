import type {
  DatabaseConnectionConfig,
  DatabaseProvider,
  DatabaseSession,
  ExplainPlan,
  IntrospectionOptions,
  QueryExecution,
  QueryRequest,
} from "@nublox/workbench-provider-api";
import type { DatabaseCatalog } from "@nublox/workbench-catalog";

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

function normalizeProviderId(value: string): string {
  const id = value.trim().toLowerCase();
  if (!id) {
    throw new Error("Database provider id cannot be empty.");
  }
  return id;
}

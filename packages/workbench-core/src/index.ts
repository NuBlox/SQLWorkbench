import type {
  DatabaseConnectionConfig,
  DatabaseExplorerProvider,
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
  DatabaseObjectKind,
  DatabasePrincipal,
  DatabasePrivilege,
  DatabaseSearchResult,
  EventDefinition,
  ForeignKeyDefinition,
  IndexDefinition,
  RoleGrantDefinition,
  RoutineDefinition,
  TableDefinition,
  TriggerDefinition,
} from "@nublox/workbench-catalog";

export class ProviderRegistry {
  readonly #providers = new Map<string, DatabaseProvider>();
  register(provider: DatabaseProvider): void {
    const id = normalizeProviderId(provider.id);
    if (this.#providers.has(id)) throw new Error(`Database provider '${provider.id}' is already registered.`);
    this.#providers.set(id, provider);
  }
  get(providerId: string): DatabaseProvider {
    const provider = this.#providers.get(normalizeProviderId(providerId));
    if (!provider) throw new Error(`Database provider '${providerId}' is not registered.`);
    return provider;
  }
  list(): readonly DatabaseProvider[] { return [...this.#providers.values()]; }
}

export interface WorkbenchConnection { readonly id: string; readonly provider: DatabaseProvider; readonly session: DatabaseSession; }

export class ConnectionManager {
  readonly #connections = new Map<string, WorkbenchConnection>();
  constructor(readonly providers: ProviderRegistry) {}
  async connect(id: string, config: DatabaseConnectionConfig): Promise<WorkbenchConnection> {
    if (this.#connections.has(id)) throw new Error(`Connection '${id}' is already open.`);
    const provider = this.providers.get(config.providerId);
    const session = await provider.connect(config);
    const connection = { id, provider, session } satisfies WorkbenchConnection;
    this.#connections.set(id, connection);
    return connection;
  }
  get(id: string): WorkbenchConnection {
    const connection = this.#connections.get(id);
    if (!connection) throw new Error(`Connection '${id}' is not open.`);
    return connection;
  }
  list(): readonly WorkbenchConnection[] { return [...this.#connections.values()]; }
  async disconnect(id: string): Promise<void> { const connection = this.get(id); this.#connections.delete(id); await connection.session.close(); }
  async disconnectAll(): Promise<void> {
    const connections = [...this.#connections.values()]; this.#connections.clear();
    const results = await Promise.allSettled(connections.map(({ session }) => session.close()));
    const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failure) throw failure.reason;
  }
}

export class QueryService {
  constructor(readonly connections: ConnectionManager) {}
  execute(connectionId: string, request: QueryRequest): Promise<QueryExecution> { const { provider, session } = this.connections.get(connectionId); return provider.execute(session, request); }
  explain(connectionId: string, request: QueryRequest): Promise<ExplainPlan> { const { provider, session } = this.connections.get(connectionId); return provider.explain(session, request); }
  introspect(connectionId: string, options?: IntrospectionOptions): Promise<DatabaseCatalog> { const { provider, session } = this.connections.get(connectionId); return provider.introspect(session, options); }
}

export interface ExplorerNamespace { readonly key: string; readonly catalog?: string; readonly schema?: string; readonly label: string; readonly system: boolean; readonly defaultCharacterSet?: string; readonly defaultCollation?: string; }
export interface ExplorerRelation { readonly key: string; readonly catalog?: string; readonly schema?: string; readonly name: string; readonly kind: "table" | "view"; readonly engine?: string; readonly estimatedRows?: number; readonly comment?: string; }
export interface ExplorerRelationDetails { readonly relation: ExplorerRelation; readonly columns: readonly ColumnDefinition[]; readonly indexes: readonly IndexDefinition[]; readonly foreignKeys: readonly ForeignKeyDefinition[]; }
export interface ExplorerRoutine { readonly key: string; readonly catalog?: string; readonly schema?: string; readonly name: string; readonly kind: "procedure" | "function"; readonly dataType?: string; readonly definition?: string; readonly securityType?: string; readonly sqlDataAccess?: string; readonly deterministic?: boolean; readonly createdAt?: string; readonly alteredAt?: string; readonly comment?: string; }
export interface ExplorerTrigger { readonly key: string; readonly catalog?: string; readonly schema?: string; readonly name: string; readonly table: string; readonly event: string; readonly timing: string; readonly statement?: string; }
export interface ExplorerEvent { readonly key: string; readonly catalog?: string; readonly schema?: string; readonly name: string; readonly definition?: string; readonly scheduleType?: string; readonly executeAt?: string; readonly intervalValue?: string; readonly intervalField?: string; readonly startsAt?: string; readonly endsAt?: string; readonly status?: string; readonly onCompletion?: string; readonly comment?: string; }
export interface ExplorerPrincipal { readonly grantee: string; readonly name: string; readonly host?: string; readonly kind: "user" | "role" | "unknown"; }
export interface ExplorerRoleGrant { readonly grantee: string; readonly role: string; readonly grantable: boolean; readonly defaultRole?: boolean; }
export interface ExplorerPrivilege { readonly grantee: string; readonly privilege: string; readonly scope: "global" | "schema" | "table" | "column"; readonly catalog?: string; readonly schema?: string; readonly table?: string; readonly column?: string; readonly grantable: boolean; }
export interface ExplorerSearchResult { readonly key: string; readonly catalog?: string; readonly schema?: string; readonly name: string; readonly kind: DatabaseObjectKind; readonly comment?: string; }

export interface ExplorerNamespaceRequest { readonly connectionId: string; readonly includeSystem?: boolean; }
export interface ExplorerRelationRequest { readonly connectionId: string; readonly catalog?: string; readonly schema?: string; readonly includeSystem?: boolean; }
export interface ExplorerRelationDetailsRequest extends ExplorerRelationRequest { readonly name: string; }
export interface ExplorerSearchRequest { readonly connectionId: string; readonly term: string; readonly catalog?: string; readonly schema?: string; readonly limit?: number; }
export interface ExplorerPrivilegeRequest { readonly connectionId: string; readonly grantee?: string; }

export class DatabaseExplorerService {
  readonly #queries: QueryService;
  constructor(readonly connections: ConnectionManager) { this.#queries = new QueryService(connections); }

  async listNamespaces(request: ExplorerNamespaceRequest): Promise<readonly ExplorerNamespace[]> {
    this.#requireIntrospection(request.connectionId);
    const fine = this.#fineExplorer(request.connectionId);
    if (fine) {
      const items = await fine.explorer.listNamespaces(fine.session, { includeSystem: request.includeSystem ?? false });
      return items.map((item) => ({ key: namespaceKey(item.catalog, item.schema), ...(item.catalog ? { catalog: item.catalog } : {}), ...(item.schema ? { schema: item.schema } : {}), label: qualifiedLabel(item.catalog, item.schema), system: item.system, ...(item.defaultCharacterSet ? { defaultCharacterSet: item.defaultCharacterSet } : {}), ...(item.defaultCollation ? { defaultCollation: item.defaultCollation } : {}) }));
    }
    const catalog = await this.#queries.introspect(request.connectionId, { includeSystem: request.includeSystem ?? false, depth: "namespaces" });
    return catalog.namespaces.map(toExplorerNamespace);
  }

  async listRelations(request: ExplorerRelationRequest): Promise<readonly ExplorerRelation[]> {
    this.#requireIntrospection(request.connectionId);
    const fine = this.#fineExplorer(request.connectionId);
    if (fine) {
      const items = await fine.explorer.listObjects(fine.session, { ...(request.catalog ? { catalog: request.catalog } : {}), ...(request.schema ? { schema: request.schema } : {}) });
      return items.filter((item): item is typeof item & { kind: "table" | "view" } => item.kind === "table" || item.kind === "view").map((item) => ({ key: `${namespaceKey(item.catalog, item.schema)}\u001f${item.name}`, ...(item.catalog ? { catalog: item.catalog } : {}), ...(item.schema ? { schema: item.schema } : {}), name: item.name, kind: item.kind, ...(item.comment ? { comment: item.comment } : {}) }));
    }
    const catalog = await this.#queries.introspect(request.connectionId, { includeSystem: request.includeSystem ?? false, depth: "relations", ...(request.catalog ? { catalogs: [request.catalog] } : {}) });
    return findNamespace(catalog, request.catalog, request.schema).tables.map(toExplorerRelation);
  }

  async describeRelation(request: ExplorerRelationDetailsRequest): Promise<ExplorerRelationDetails> {
    this.#requireIntrospection(request.connectionId);
    const name = request.name.trim(); if (!name) throw new Error("Relation name cannot be empty.");
    const fine = this.#fineExplorer(request.connectionId);
    if (fine) {
      const table = await fine.explorer.describeTable(fine.session, { ...(request.catalog ? { catalog: request.catalog } : {}), ...(request.schema ? { schema: request.schema } : {}), name });
      return { relation: toExplorerRelation(table), columns: table.columns, indexes: table.indexes, foreignKeys: table.foreignKeys };
    }
    const catalog = await this.#queries.introspect(request.connectionId, { includeSystem: request.includeSystem ?? false, depth: "full", ...(request.catalog ? { catalogs: [request.catalog] } : {}) });
    const relation = findNamespace(catalog, request.catalog, request.schema).tables.find((table) => table.name === name);
    if (!relation) throw new Error(`Relation '${qualifiedLabel(request.catalog, request.schema, name)}' was not found.`);
    return { relation: toExplorerRelation(relation), columns: relation.columns, indexes: relation.indexes, foreignKeys: relation.foreignKeys };
  }

  async listRoutines(request: ExplorerRelationRequest): Promise<readonly ExplorerRoutine[]> {
    const { explorer, session } = this.#requireFineExplorer(request.connectionId, "routines");
    return (await explorer.listRoutines(session, namespaceRef(request))).map(toExplorerRoutine);
  }
  async listTriggers(request: ExplorerRelationRequest): Promise<readonly ExplorerTrigger[]> {
    const { explorer, session } = this.#requireFineExplorer(request.connectionId, "triggers");
    return (await explorer.listTriggers(session, namespaceRef(request))).map(toExplorerTrigger);
  }
  async listEvents(request: ExplorerRelationRequest): Promise<readonly ExplorerEvent[]> {
    const { explorer, session } = this.#requireFineExplorer(request.connectionId, "events");
    return (await explorer.listEvents(session, namespaceRef(request))).map(toExplorerEvent);
  }
  async listPrincipals(connectionId: string): Promise<readonly ExplorerPrincipal[]> {
    const { explorer, session } = this.#requireFineExplorer(connectionId, "principal/privilege introspection");
    return (await explorer.listPrincipals(session)).map((item: DatabasePrincipal) => ({ ...item }));
  }
  async listRoleGrants(connectionId: string): Promise<readonly ExplorerRoleGrant[]> {
    const { explorer, session } = this.#requireFineExplorer(connectionId, "role introspection");
    return (await explorer.listRoleGrants(session)).map((item: RoleGrantDefinition) => ({ ...item }));
  }
  async listPrivileges(request: ExplorerPrivilegeRequest): Promise<readonly ExplorerPrivilege[]> {
    const { explorer, session } = this.#requireFineExplorer(request.connectionId, "privilege introspection");
    return (await explorer.listPrivileges(session, request.grantee)).map((item: DatabasePrivilege) => ({ ...item }));
  }
  async search(request: ExplorerSearchRequest): Promise<readonly ExplorerSearchResult[]> {
    const { explorer, session } = this.#requireFineExplorer(request.connectionId, "object search");
    const items = await explorer.search(session, { term: request.term, ...(request.catalog || request.schema ? { namespace: { ...(request.catalog ? { catalog: request.catalog } : {}), ...(request.schema ? { schema: request.schema } : {}) } } : {}), ...(request.limit !== undefined ? { limit: request.limit } : {}) });
    return items.map(toExplorerSearchResult);
  }

  #requireIntrospection(connectionId: string): void {
    const { provider } = this.connections.get(connectionId);
    if (!provider.capabilities.catalogIntrospection) throw new Error(`Database provider '${provider.id}' does not support catalogue introspection.`);
  }
  #fineExplorer(connectionId: string): { explorer: DatabaseExplorerProvider; session: DatabaseSession } | undefined {
    const { provider, session } = this.connections.get(connectionId);
    return provider.explorer ? { explorer: provider.explorer, session } : undefined;
  }
  #requireFineExplorer(connectionId: string, feature: string): { explorer: DatabaseExplorerProvider; session: DatabaseSession } {
    const result = this.#fineExplorer(connectionId);
    if (!result) { const { provider } = this.connections.get(connectionId); throw new Error(`Database provider '${provider.id}' does not support ${feature}.`); }
    return result;
  }
}

function namespaceRef(request: ExplorerRelationRequest) { return { ...(request.catalog ? { catalog: request.catalog } : {}), ...(request.schema ? { schema: request.schema } : {}) }; }
function findNamespace(catalog: DatabaseCatalog, requestedCatalog?: string, requestedSchema?: string): DatabaseNamespace {
  const namespace = catalog.namespaces.find((candidate) => (requestedCatalog === undefined || candidate.catalog === requestedCatalog) && (requestedSchema === undefined || candidate.schema === requestedSchema));
  if (!namespace) throw new Error(`Namespace '${qualifiedLabel(requestedCatalog, requestedSchema)}' was not found.`);
  return namespace;
}
function toExplorerNamespace(namespace: DatabaseNamespace): ExplorerNamespace { return { key: namespaceKey(namespace.catalog, namespace.schema), ...(namespace.catalog ? { catalog: namespace.catalog } : {}), ...(namespace.schema ? { schema: namespace.schema } : {}), label: qualifiedLabel(namespace.catalog, namespace.schema), system: namespace.system, ...(namespace.defaultCharacterSet ? { defaultCharacterSet: namespace.defaultCharacterSet } : {}), ...(namespace.defaultCollation ? { defaultCollation: namespace.defaultCollation } : {}) }; }
function toExplorerRelation(table: TableDefinition): ExplorerRelation { return { key: `${namespaceKey(table.catalog, table.schema)}\u001f${table.name}`, ...(table.catalog ? { catalog: table.catalog } : {}), ...(table.schema ? { schema: table.schema } : {}), name: table.name, kind: table.kind, ...(table.engine ? { engine: table.engine } : {}), ...(table.estimatedRows !== undefined ? { estimatedRows: table.estimatedRows } : {}), ...(table.comment ? { comment: table.comment } : {}) }; }
function toExplorerRoutine(item: RoutineDefinition): ExplorerRoutine { return { key: `${namespaceKey(item.catalog, item.schema)}\u001f${item.kind}\u001f${item.name}`, ...(item.catalog ? { catalog: item.catalog } : {}), ...(item.schema ? { schema: item.schema } : {}), name: item.name, kind: item.kind, ...(item.dataType ? { dataType: item.dataType } : {}), ...(item.definition ? { definition: item.definition } : {}), ...(item.securityType ? { securityType: item.securityType } : {}), ...(item.sqlDataAccess ? { sqlDataAccess: item.sqlDataAccess } : {}), ...(item.deterministic !== undefined ? { deterministic: item.deterministic } : {}), ...(item.createdAt ? { createdAt: item.createdAt } : {}), ...(item.alteredAt ? { alteredAt: item.alteredAt } : {}), ...(item.comment ? { comment: item.comment } : {}) }; }
function toExplorerTrigger(item: TriggerDefinition): ExplorerTrigger { return { key: `${namespaceKey(item.catalog, item.schema)}\u001ftrigger\u001f${item.name}`, ...(item.catalog ? { catalog: item.catalog } : {}), ...(item.schema ? { schema: item.schema } : {}), name: item.name, table: item.table, event: item.event, timing: item.timing, ...(item.statement ? { statement: item.statement } : {}) }; }
function toExplorerEvent(item: EventDefinition): ExplorerEvent { return { key: `${namespaceKey(item.catalog, item.schema)}\u001fevent\u001f${item.name}`, ...(item.catalog ? { catalog: item.catalog } : {}), ...(item.schema ? { schema: item.schema } : {}), name: item.name, ...(item.definition ? { definition: item.definition } : {}), ...(item.scheduleType ? { scheduleType: item.scheduleType } : {}), ...(item.executeAt ? { executeAt: item.executeAt } : {}), ...(item.intervalValue ? { intervalValue: item.intervalValue } : {}), ...(item.intervalField ? { intervalField: item.intervalField } : {}), ...(item.startsAt ? { startsAt: item.startsAt } : {}), ...(item.endsAt ? { endsAt: item.endsAt } : {}), ...(item.status ? { status: item.status } : {}), ...(item.onCompletion ? { onCompletion: item.onCompletion } : {}), ...(item.comment ? { comment: item.comment } : {}) }; }
function toExplorerSearchResult(item: DatabaseSearchResult): ExplorerSearchResult { return { key: `${namespaceKey(item.catalog, item.schema)}\u001f${item.kind}\u001f${item.name}`, ...(item.catalog ? { catalog: item.catalog } : {}), ...(item.schema ? { schema: item.schema } : {}), name: item.name, kind: item.kind, ...(item.comment ? { comment: item.comment } : {}) }; }
function namespaceKey(catalog?: string, schema?: string): string { return `${catalog ?? ""}\u001f${schema ?? ""}`; }
function qualifiedLabel(catalog?: string, schema?: string, name?: string): string { const parts = [catalog, schema, name].filter((value): value is string => Boolean(value)); return parts.length ? parts.join(".") : "default"; }
function normalizeProviderId(value: string): string { const id = value.trim().toLowerCase(); if (!id) throw new Error("Database provider id cannot be empty."); return id; }

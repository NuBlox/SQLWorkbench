import type { Pool } from "pg";
import type {
  DatabaseNamespaceReference,
  DatabaseNamespaceSummary,
  DatabaseObjectSummary,
  DatabasePrincipal,
  DatabasePrivilege,
  DatabaseSearchResult,
  EventDefinition,
  RoleGrantDefinition,
  RoutineDefinition,
  TableDefinition,
  TriggerDefinition,
} from "@nublox/workbench-catalog";
import type {
  DatabaseCapabilities,
  DatabaseConnectionConfig,
  DatabaseExplorerProvider,
  DatabaseSession,
  ExplorerNamespaceOptions,
  ExplorerObjectReference,
  ExplorerSearchRequest,
  QueryExecution,
  QueryRequest,
} from "@nublox/workbench-provider-api";
import {
  PostgreSqlDatabaseProvider as FoundationPostgreSqlDatabaseProvider,
  postgresqlCapabilities as foundationPostgresqlCapabilities,
} from "./index.js";
import {
  POSTGRESQL_PRINCIPALS_SQL,
  POSTGRESQL_PRIVILEGES_SQL,
  POSTGRESQL_ROLE_GRANTS_SQL,
  POSTGRESQL_ROUTINES_SQL,
  POSTGRESQL_SEARCH_SQL,
  POSTGRESQL_TRIGGERS_SQL,
  mapPostgreSqlPrincipals,
  mapPostgreSqlPrivileges,
  mapPostgreSqlRoleGrants,
  mapPostgreSqlRoutines,
  mapPostgreSqlSearchResults,
  mapPostgreSqlTriggers,
  normalizePostgreSqlSearchLimit,
  postgreSqlSearchPattern,
  type PostgreSqlPrincipalRow,
  type PostgreSqlPrivilegeRow,
  type PostgreSqlRoleGrantRow,
  type PostgreSqlRoutineRow,
  type PostgreSqlSearchRow,
  type PostgreSqlTriggerRow,
} from "./catalog-security.js";
import {
  createPostgreSqlControlPool,
  executePostgreSqlRequest,
} from "./execution.js";

export const postgresqlCapabilities: DatabaseCapabilities = Object.freeze({
  ...foundationPostgresqlCapabilities,
  procedures: true,
  functions: true,
  triggers: true,
  queryCancellation: true,
  objectSearch: true,
  privilegeIntrospection: true,
});

export class PostgreSqlDatabaseProvider extends FoundationPostgreSqlDatabaseProvider {
  override readonly capabilities = postgresqlCapabilities;
  override readonly explorer: DatabaseExplorerProvider;
  private readonly controlPools = new WeakMap<DatabaseSession, Pool>();

  constructor() {
    super();
    const foundationExplorer = new FoundationPostgreSqlDatabaseProvider().explorer;
    if (!foundationExplorer) {
      throw new Error("PostgreSQL foundation explorer is unavailable.");
    }
    this.explorer = new PostgreSqlCatalogSecurityExplorer(foundationExplorer);
  }

  override async connect(config: DatabaseConnectionConfig): Promise<DatabaseSession> {
    const session = await super.connect(config);
    const controlPool = createPostgreSqlControlPool(config);
    this.controlPools.set(session, controlPool);

    const closeFoundationSession = session.close.bind(session);
    let closed = false;
    session.close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      this.controlPools.delete(session);
      const outcomes = await Promise.allSettled([
        closeFoundationSession(),
        controlPool.end(),
      ]);
      const failure = outcomes.find((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
      if (failure) throw failure.reason;
    };

    return session;
  }

  override execute(session: DatabaseSession, request: QueryRequest): Promise<QueryExecution> {
    const controlPool = this.controlPools.get(session);
    if (!controlPool) {
      throw new Error("PostgreSQL query control is unavailable for this session.");
    }
    return executePostgreSqlRequest(poolFor(session), controlPool, request);
  }
}

class PostgreSqlCatalogSecurityExplorer implements DatabaseExplorerProvider {
  constructor(private readonly foundation: DatabaseExplorerProvider) {}

  listNamespaces(session: DatabaseSession, options?: ExplorerNamespaceOptions): Promise<readonly DatabaseNamespaceSummary[]> {
    return this.foundation.listNamespaces(session, options);
  }

  listObjects(session: DatabaseSession, namespace: DatabaseNamespaceReference): Promise<readonly DatabaseObjectSummary[]> {
    return this.foundation.listObjects(session, namespace);
  }

  describeTable(session: DatabaseSession, object: ExplorerObjectReference): Promise<TableDefinition> {
    return this.foundation.describeTable(session, object);
  }

  async listRoutines(session: DatabaseSession, namespace: DatabaseNamespaceReference): Promise<readonly RoutineDefinition[]> {
    const schema = requireSchema(namespace);
    const rows = await queryRows<PostgreSqlRoutineRow>(session, POSTGRESQL_ROUTINES_SQL, [schema]);
    return mapPostgreSqlRoutines(rows);
  }

  async listTriggers(session: DatabaseSession, namespace: DatabaseNamespaceReference): Promise<readonly TriggerDefinition[]> {
    const schema = requireSchema(namespace);
    const rows = await queryRows<PostgreSqlTriggerRow>(session, POSTGRESQL_TRIGGERS_SQL, [schema]);
    return mapPostgreSqlTriggers(rows);
  }

  async listEvents(): Promise<readonly EventDefinition[]> {
    return [];
  }

  async listPrincipals(session: DatabaseSession): Promise<readonly DatabasePrincipal[]> {
    const rows = await queryRows<PostgreSqlPrincipalRow>(session, POSTGRESQL_PRINCIPALS_SQL);
    return mapPostgreSqlPrincipals(rows);
  }

  async listRoleGrants(session: DatabaseSession): Promise<readonly RoleGrantDefinition[]> {
    const rows = await queryRows<PostgreSqlRoleGrantRow>(session, POSTGRESQL_ROLE_GRANTS_SQL);
    return mapPostgreSqlRoleGrants(rows);
  }

  async listPrivileges(session: DatabaseSession, grantee?: string): Promise<readonly DatabasePrivilege[]> {
    const rows = await queryRows<PostgreSqlPrivilegeRow>(session, POSTGRESQL_PRIVILEGES_SQL, [grantee?.trim() || null]);
    return mapPostgreSqlPrivileges(rows);
  }

  async search(session: DatabaseSession, request: ExplorerSearchRequest): Promise<readonly DatabaseSearchResult[]> {
    const term = request.term.trim();
    if (!term) return [];
    const schema = request.namespace?.schema?.trim() || null;
    const rows = await queryRows<PostgreSqlSearchRow>(session, POSTGRESQL_SEARCH_SQL, [
      postgreSqlSearchPattern(term),
      schema,
      normalizePostgreSqlSearchLimit(request.limit),
    ]);
    return mapPostgreSqlSearchResults(rows);
  }
}

function requireSchema(namespace: DatabaseNamespaceReference): string {
  const schema = namespace.schema?.trim();
  if (!schema) {
    throw new Error("PostgreSQL explorer operations require a schema name.");
  }
  return schema;
}

async function queryRows<T>(session: DatabaseSession, sql: string, values: readonly unknown[] = []): Promise<T[]> {
  const pool = poolFor(session);
  const result = values.length > 0 ? await pool.query(sql, [...values]) : await pool.query(sql);
  return result.rows as unknown as T[];
}

function poolFor(session: DatabaseSession): Pool {
  if (session.providerId !== "postgresql") {
    throw new Error(`PostgreSQL explorer cannot use provider '${session.providerId}'.`);
  }
  const candidate = session as DatabaseSession & { readonly pool?: Pool };
  if (!candidate.pool || typeof candidate.pool.query !== "function") {
    throw new Error("PostgreSQL session does not expose its connection pool.");
  }
  return candidate.pool;
}

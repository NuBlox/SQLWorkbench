import assert from "node:assert/strict";
import test from "node:test";

import {
  ConnectionManager,
  DatabaseExplorerService,
  ProviderRegistry,
  QueryService,
} from "../dist/index.js";

function fakeProvider({ fineExplorer = false } = {}) {
  let closed = false;
  const introspectionCalls = [];
  const explorerCalls = [];
  const provider = {
    id: "fake",
    displayName: "Fake Database",
    capabilities: {
      catalogIntrospection: true,
      schemas: false,
      views: true,
      indexes: true,
      foreignKeys: true,
      procedures: true,
      functions: true,
      triggers: true,
      events: true,
      partitions: false,
      transactions: true,
      savepoints: false,
      explainPlan: true,
      queryCancellation: false,
      objectSearch: true,
      privilegeIntrospection: true,
      serverAdministration: false,
      userAdministration: false,
    },
    async connect() {
      return {
        id: "session-1",
        providerId: "fake",
        connectedAt: new Date(0).toISOString(),
        async health() { return { ok: true }; },
        async close() { closed = true; },
      };
    },
    async introspect(_session, options = {}) {
      introspectionCalls.push(options);
      const relations = options.depth === "namespaces"
        ? []
        : [{
            catalog: "app",
            name: "orders",
            kind: "table",
            engine: "fake-engine",
            estimatedRows: 42,
            columns: options.depth === "full" ? [{ name: "id", ordinal: 1, dataType: "integer", databaseType: "int", nullable: false, autoIncrement: true, generated: false }] : [],
            indexes: options.depth === "full" ? [{ name: "PRIMARY", primary: true, unique: true, columns: [{ name: "id", sequence: 1 }] }] : [],
            foreignKeys: [],
          }];
      return {
        providerId: "fake",
        server: { product: "Fake" },
        namespaces: [{ catalog: "app", system: false, defaultCharacterSet: "utf8mb4", defaultCollation: "utf8mb4_0900_ai_ci", tables: relations }],
        capturedAt: new Date(0).toISOString(),
      };
    },
    async execute() {
      return { startedAt: new Date(0).toISOString(), finishedAt: new Date(0).toISOString(), elapsedMs: 0, resultSets: [{ columns: [], rows: [{ value: 1 }] }] };
    },
    async explain() { return { format: "fake", raw: {} }; },
    quoteIdentifier(value) { return `\"${value}\"`; },
    wasClosed() { return closed; },
    introspectionCalls() { return [...introspectionCalls]; },
    explorerCalls() { return [...explorerCalls]; },
  };

  if (fineExplorer) {
    provider.explorer = {
      async listNamespaces() { explorerCalls.push("namespaces"); return [{ catalog: "app", system: false }]; },
      async listObjects() { explorerCalls.push("objects"); return [{ catalog: "app", name: "orders", kind: "table" }, { catalog: "app", name: "order_view", kind: "view" }]; },
      async describeTable() { explorerCalls.push("describe"); return { catalog: "app", name: "orders", kind: "table", columns: [], indexes: [], foreignKeys: [] }; },
      async listRoutines() { explorerCalls.push("routines"); return [{ catalog: "app", name: "rebuild_orders", kind: "procedure" }]; },
      async listTriggers() { explorerCalls.push("triggers"); return [{ catalog: "app", name: "orders_bi", kind: "trigger", table: "orders", event: "INSERT", timing: "BEFORE" }]; },
      async listEvents() { explorerCalls.push("events"); return [{ catalog: "app", name: "nightly", kind: "event", status: "ENABLED" }]; },
      async listPrincipals() { explorerCalls.push("principals"); return [{ grantee: "'app'@'%'", name: "app", host: "%", kind: "user" }]; },
      async listRoleGrants() { explorerCalls.push("roles"); return [{ grantee: "'app'@'%'", role: "'reader'@'%'", grantable: false }]; },
      async listPrivileges() { explorerCalls.push("privileges"); return [{ grantee: "'app'@'%'", privilege: "SELECT", scope: "global", grantable: false }]; },
      async search() { explorerCalls.push("search"); return [{ catalog: "app", name: "orders", kind: "table" }]; },
    };
  }
  return provider;
}

async function connectedFixture(options) {
  const registry = new ProviderRegistry();
  const provider = fakeProvider(options);
  registry.register(provider);
  const connections = new ConnectionManager(registry);
  await connections.connect("dev", { providerId: "fake", host: "localhost", user: "test" });
  return { provider, connections };
}

test("registry rejects duplicate provider ids case-insensitively", () => {
  const registry = new ProviderRegistry();
  const provider = fakeProvider();
  registry.register(provider);
  assert.throws(() => registry.register({ ...provider, id: "FAKE" }), /already registered/);
});

test("connection manager and query service preserve provider ownership", async () => {
  const { provider, connections } = await connectedFixture();
  const queries = new QueryService(connections);
  const result = await queries.execute("dev", { sql: "select 1" });
  assert.deepEqual(result.resultSets[0].rows, [{ value: 1 }]);
  await connections.disconnect("dev");
  assert.equal(provider.wasClosed(), true);
});

test("database explorer retains progressive introspection fallback", async () => {
  const { provider, connections } = await connectedFixture();
  const explorer = new DatabaseExplorerService(connections);
  const namespaces = await explorer.listNamespaces({ connectionId: "dev" });
  assert.equal(namespaces[0].label, "app");
  const relations = await explorer.listRelations({ connectionId: "dev", catalog: "app" });
  assert.equal(relations[0].name, "orders");
  const details = await explorer.describeRelation({ connectionId: "dev", catalog: "app", name: "orders" });
  assert.equal(details.columns[0].name, "id");
  assert.deepEqual(provider.introspectionCalls().map((call) => call.depth), ["namespaces", "relations", "full"]);
});

test("database explorer prefers fine-grained provider metadata and exposes advanced objects", async () => {
  const { provider, connections } = await connectedFixture({ fineExplorer: true });
  const explorer = new DatabaseExplorerService(connections);
  assert.equal((await explorer.listNamespaces({ connectionId: "dev" }))[0].label, "app");
  assert.equal((await explorer.listRelations({ connectionId: "dev", catalog: "app" })).length, 2);
  assert.equal((await explorer.describeRelation({ connectionId: "dev", catalog: "app", name: "orders" })).relation.name, "orders");
  assert.equal((await explorer.listRoutines({ connectionId: "dev", catalog: "app" }))[0].kind, "procedure");
  assert.equal((await explorer.listTriggers({ connectionId: "dev", catalog: "app" }))[0].table, "orders");
  assert.equal((await explorer.listEvents({ connectionId: "dev", catalog: "app" }))[0].status, "ENABLED");
  assert.equal((await explorer.listPrincipals("dev"))[0].name, "app");
  assert.equal((await explorer.listRoleGrants("dev"))[0].role, "'reader'@'%'");
  assert.equal((await explorer.listPrivileges({ connectionId: "dev" }))[0].privilege, "SELECT");
  assert.equal((await explorer.search({ connectionId: "dev", term: "order" }))[0].name, "orders");
  assert.deepEqual(provider.introspectionCalls(), []);
  assert.deepEqual(provider.explorerCalls(), ["namespaces", "objects", "describe", "routines", "triggers", "events", "principals", "roles", "privileges", "search"]);
});

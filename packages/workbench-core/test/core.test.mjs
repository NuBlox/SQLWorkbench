import assert from "node:assert/strict";
import test from "node:test";

import { ConnectionManager, DatabaseExplorerService, ProviderRegistry, QueryService } from "../dist/index.js";

function fakeProvider() {
  let closed = false;
  return {
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
    explorer: {
      async listNamespaces() { return [{ catalog: "app", system: false }]; },
      async listObjects() { return [{ catalog: "app", name: "users", kind: "table" }]; },
      async describeTable() {
        return { catalog: "app", name: "users", kind: "table", columns: [], indexes: [], foreignKeys: [] };
      },
      async listRoutines() { return []; },
      async listTriggers() { return []; },
      async listEvents() { return []; },
      async listPrincipals() { return [{ grantee: "'app'@'%'", name: "app", host: "%", kind: "user" }]; },
      async listRoleGrants() { return []; },
      async listPrivileges() { return [{ grantee: "'app'@'%'", privilege: "SELECT", scope: "global", grantable: false }]; },
      async search() { return [{ catalog: "app", name: "users", kind: "table" }]; },
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
    async introspect() {
      return { providerId: "fake", server: { product: "Fake" }, namespaces: [], capturedAt: new Date(0).toISOString() };
    },
    async execute() {
      return { startedAt: new Date(0).toISOString(), finishedAt: new Date(0).toISOString(), elapsedMs: 0, resultSets: [{ columns: [], rows: [{ value: 1 }] }] };
    },
    async explain() { return { format: "fake", raw: {} }; },
    quoteIdentifier(value) { return `\"${value}\"`; },
    wasClosed() { return closed; },
  };
}

test("registry rejects duplicate provider ids case-insensitively", () => {
  const registry = new ProviderRegistry();
  const provider = fakeProvider();
  registry.register(provider);
  assert.throws(() => registry.register({ ...provider, id: "FAKE" }), /already registered/);
});

test("connection manager and query service preserve provider ownership", async () => {
  const registry = new ProviderRegistry();
  const provider = fakeProvider();
  registry.register(provider);
  const connections = new ConnectionManager(registry);
  const queries = new QueryService(connections);
  await connections.connect("dev", { providerId: "fake", host: "localhost", user: "test" });
  const result = await queries.execute("dev", { sql: "select 1" });
  assert.deepEqual(result.resultSets[0].rows, [{ value: 1 }]);
  await connections.disconnect("dev");
  assert.equal(provider.wasClosed(), true);
});

test("database explorer delegates lazy metadata operations to the owning provider", async () => {
  const registry = new ProviderRegistry();
  registry.register(fakeProvider());
  const connections = new ConnectionManager(registry);
  await connections.connect("dev", { providerId: "fake", host: "localhost", user: "test" });
  const explorer = new DatabaseExplorerService(connections);
  assert.deepEqual(await explorer.listNamespaces("dev"), [{ catalog: "app", system: false }]);
  assert.deepEqual(await explorer.listObjects("dev", { catalog: "app" }), [{ catalog: "app", name: "users", kind: "table" }]);
  assert.equal((await explorer.describeTable("dev", { catalog: "app", name: "users" })).name, "users");
  assert.equal((await explorer.search("dev", { term: "user" }))[0].name, "users");
  assert.equal((await explorer.listPrivileges("dev"))[0].privilege, "SELECT");
});

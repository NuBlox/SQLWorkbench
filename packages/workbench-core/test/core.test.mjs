import assert from "node:assert/strict";
import test from "node:test";

import {
  ConnectionManager,
  DatabaseExplorerService,
  ProviderRegistry,
  QueryService,
} from "../dist/index.js";

function fakeProvider() {
  let closed = false;
  const introspectionCalls = [];
  return {
    id: "fake",
    displayName: "Fake Database",
    capabilities: {
      catalogIntrospection: true,
      schemas: false,
      views: true,
      indexes: true,
      foreignKeys: true,
      procedures: false,
      functions: false,
      triggers: false,
      partitions: false,
      transactions: true,
      savepoints: false,
      explainPlan: true,
      queryCancellation: false,
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
        : [
            {
              catalog: "app",
              name: "orders",
              kind: "table",
              engine: "fake-engine",
              estimatedRows: 42,
              columns: options.depth === "full"
                ? [
                    {
                      name: "id",
                      ordinal: 1,
                      dataType: "integer",
                      databaseType: "int",
                      nullable: false,
                      autoIncrement: true,
                      generated: false,
                    },
                  ]
                : [],
              indexes: options.depth === "full"
                ? [
                    {
                      name: "PRIMARY",
                      primary: true,
                      unique: true,
                      columns: [{ name: "id", sequence: 1 }],
                    },
                  ]
                : [],
              foreignKeys: [],
            },
          ];
      return {
        providerId: "fake",
        server: { product: "Fake" },
        namespaces: [
          {
            catalog: "app",
            system: false,
            defaultCharacterSet: "utf8mb4",
            defaultCollation: "utf8mb4_0900_ai_ci",
            tables: relations,
          },
        ],
        capturedAt: new Date(0).toISOString(),
      };
    },
    async execute() {
      return {
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(0).toISOString(),
        elapsedMs: 0,
        resultSets: [{ columns: [], rows: [{ value: 1 }] }],
      };
    },
    async explain() { return { format: "fake", raw: {} }; },
    quoteIdentifier(value) { return `\"${value}\"`; },
    wasClosed() { return closed; },
    introspectionCalls() { return [...introspectionCalls]; },
  };
}

async function connectedFixture() {
  const registry = new ProviderRegistry();
  const provider = fakeProvider();
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

test("database explorer loads namespace, relation and relation details progressively", async () => {
  const { provider, connections } = await connectedFixture();
  const explorer = new DatabaseExplorerService(connections);

  const namespaces = await explorer.listNamespaces({ connectionId: "dev" });
  assert.deepEqual(namespaces, [
    {
      key: "app\u001f",
      catalog: "app",
      label: "app",
      system: false,
      defaultCharacterSet: "utf8mb4",
      defaultCollation: "utf8mb4_0900_ai_ci",
    },
  ]);

  const relations = await explorer.listRelations({ connectionId: "dev", catalog: "app" });
  assert.equal(relations.length, 1);
  assert.equal(relations[0].name, "orders");
  assert.equal(relations[0].kind, "table");
  assert.equal(relations[0].estimatedRows, 42);

  const details = await explorer.describeRelation({
    connectionId: "dev",
    catalog: "app",
    name: "orders",
  });
  assert.equal(details.columns[0].name, "id");
  assert.equal(details.indexes[0].name, "PRIMARY");

  assert.deepEqual(
    provider.introspectionCalls().map((call) => call.depth),
    ["namespaces", "relations", "full"],
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderRegistry,
  WorkbenchCapabilities,
  type DatabaseProviderDefinition,
} from "../src/index.js";

const mysql: DatabaseProviderDefinition = {
  id: "mysql",
  displayName: "MySQL",
  version: "1",
  dialects: [{ id: "mysql", displayName: "MySQL SQL" }],
  capabilities: [
    WorkbenchCapabilities.CONNECTION,
    WorkbenchCapabilities.SQL_EXECUTION,
    WorkbenchCapabilities.SCHEMA_INTROSPECTION,
  ],
};

test("registers and resolves providers", () => {
  const registry = new ProviderRegistry();
  registry.register(mysql);

  assert.equal(registry.require("mysql"), mysql);
  assert.deepEqual(registry.list(), [mysql]);
});

test("rejects duplicate provider ids", () => {
  const registry = new ProviderRegistry();
  registry.register(mysql);

  assert.throws(() => registry.register(mysql), /already registered/);
});

test("filters providers by capability", () => {
  const registry = new ProviderRegistry();
  registry.register(mysql);

  assert.deepEqual(
    registry.supporting(WorkbenchCapabilities.SCHEMA_INTROSPECTION),
    [mysql],
  );
  assert.deepEqual(registry.supporting(WorkbenchCapabilities.BACKUP), []);
});

test("requires an explicit runtime factory", () => {
  const registry = new ProviderRegistry();
  registry.register(mysql);

  assert.throws(() => registry.createRuntime("mysql"), /does not yet expose/);
});

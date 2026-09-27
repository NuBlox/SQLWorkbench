import assert from "node:assert/strict";
import test from "node:test";

import {
  ProviderRegistry,
  WorkbenchCapabilities,
} from "@nublox/sql-workbench-core";
import { mysqlProviderDefinition } from "../src/index.js";

test("declares MySQL as the first SQL Workbench provider", () => {
  assert.equal(mysqlProviderDefinition.id, "mysql");
  assert.equal(mysqlProviderDefinition.dialects[0]?.id, "mysql");
});

test("keeps planned MySQL capabilities disabled until a runtime exists", () => {
  const registry = new ProviderRegistry();
  registry.register(mysqlProviderDefinition);

  assert.deepEqual(
    registry.supporting(WorkbenchCapabilities.SQL_EXECUTION),
    [],
  );
  assert.equal(
    registry.planning(WorkbenchCapabilities.SQL_EXECUTION)[0]?.id,
    "mysql",
  );
  assert.throws(() => registry.createRuntime("mysql"), /does not yet expose/);
});

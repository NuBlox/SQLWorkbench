import assert from "node:assert/strict";
import test from "node:test";

import {
  assertViewExecutionGuard,
  VIEW_CONFIRMATION,
  viewExecutionFingerprint,
} from "../dist/electron/main/view-execution-guard.js";

const live = {
  catalog: "demo",
  name: "active_users",
  selectSql: "select id from users where active = 1",
  algorithm: "merge",
  definer: "'app'@'localhost'",
  securityType: "definer",
  checkOption: "none",
  updatable: true,
};
const draft = { ...live, selectSql: "SELECT id, email FROM users WHERE active = 1" };
const preview = { providerId: "mysql", statements: ["ALTER VIEW ..."], destructive: false, warnings: [] };

test("view fingerprint changes when the live definition changes", () => {
  const first = viewExecutionFingerprint("conn", live, draft, preview);
  const second = viewExecutionFingerprint("conn", { ...live, selectSql: "select id, email from users" }, draft, preview);
  assert.notEqual(first, second);
});

test("view guard requires the exact confirmation and current fingerprint", () => {
  const fingerprint = viewExecutionFingerprint("conn", live, draft, preview);
  assert.doesNotThrow(() => assertViewExecutionGuard(fingerprint, fingerprint, VIEW_CONFIRMATION));
  assert.throws(() => assertViewExecutionGuard(fingerprint, "stale", VIEW_CONFIRMATION), /stale/u);
  assert.throws(() => assertViewExecutionGuard(fingerprint, fingerprint, "apply view changes"), /exact confirmation/u);
});

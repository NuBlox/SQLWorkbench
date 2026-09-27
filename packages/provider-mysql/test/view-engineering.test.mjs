import assert from "node:assert/strict";
import test from "node:test";

import { MySqlViewEngineeringProvider } from "../dist/view-engineering.js";

test("loads canonical MySQL view metadata and algorithm", async () => {
  const calls = [];
  const host = {
    quoteIdentifier: (value) => `\`${String(value).replaceAll("`", "``")}\``,
    execute: async (_session, request) => {
      calls.push(request);
      if (request.sql.startsWith("SHOW CREATE VIEW")) {
        return execution([{ "Create View": "CREATE ALGORITHM=MERGE DEFINER='app'@'localhost' SQL SECURITY INVOKER VIEW `demo`.`active_users` AS select `demo`.`users`.`id` AS `id` from `demo`.`users` WITH CASCADED CHECK OPTION" }]);
      }
      return execution([{ definition: "select `demo`.`users`.`id` AS `id` from `demo`.`users`", checkOption: "CASCADED", isUpdatable: "YES", definer: "'app'@'localhost'", securityType: "INVOKER" }]);
    },
  };
  const provider = new MySqlViewEngineeringProvider(host);
  const view = await provider.load({ id: "s", providerId: "mysql", connectedAt: "now", health: async () => ({ ok: true }), close: async () => undefined }, { catalog: "demo", name: "active_users" });

  assert.equal(view.algorithm, "merge");
  assert.equal(view.securityType, "invoker");
  assert.equal(view.checkOption, "cascaded");
  assert.equal(view.definer, "'app'@'localhost'");
  assert.equal(view.updatable, true);
  assert.match(view.selectSql, /^select /u);
  assert.equal(calls.length, 2);
});

test("previews ALTER VIEW while preserving provider metadata", () => {
  const provider = new MySqlViewEngineeringProvider({
    quoteIdentifier: (value) => `\`${String(value).replaceAll("`", "``")}\``,
    execute: async () => execution([]),
  });
  const preview = provider.preview({
    catalog: "demo",
    name: "active`users",
    selectSql: "SELECT id, email FROM users WHERE active = 1;",
    algorithm: "merge",
    definer: "'app'@'localhost'",
    securityType: "invoker",
    checkOption: "local",
  });

  assert.equal(preview.destructive, false);
  assert.equal(preview.statements.length, 1);
  assert.equal(
    preview.statements[0],
    "ALTER ALGORITHM = MERGE DEFINER = 'app'@'localhost' SQL SECURITY INVOKER VIEW `demo`.`active``users` AS SELECT id, email FROM users WHERE active = 1 WITH LOCAL CHECK OPTION;",
  );
});

test("rejects non-query view definitions", () => {
  const provider = new MySqlViewEngineeringProvider({ quoteIdentifier: (value) => `\`${value}\``, execute: async () => execution([]) });
  assert.throws(() => provider.preview({ catalog: "demo", name: "v", selectSql: "DROP TABLE users", algorithm: "undefined", securityType: "definer", checkOption: "none" }), /must begin with SELECT/u);
});

function execution(rows) {
  return { startedAt: "now", finishedAt: "now", elapsedMs: 0, resultSets: [{ columns: [], rows }] };
}

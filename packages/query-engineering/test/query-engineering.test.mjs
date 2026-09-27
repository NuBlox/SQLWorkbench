import assert from "node:assert/strict";
import test from "node:test";

import {
  MySqlQueryLanguageService,
  createQueryLanguageService,
} from "../dist/index.js";

const catalog = {
  providerId: "mysql",
  capturedAt: "2026-09-27T21:00:00.000Z",
  namespaces: [
    {
      catalog: "sales",
      label: "sales",
      relations: [
        {
          catalog: "sales",
          name: "customers",
          kind: "table",
          columns: [
            { name: "id", dataType: "int", databaseType: "int" },
            { name: "email", dataType: "varchar", databaseType: "varchar(255)" },
          ],
        },
        {
          catalog: "sales",
          name: "active_customers",
          kind: "view",
          columns: [{ name: "id", dataType: "int", databaseType: "int" }],
        },
      ],
    },
  ],
};

test("MySQL parser returns positioned syntax diagnostics", () => {
  const service = new MySqlQueryLanguageService();
  const result = service.parse("SELEC id FROM customers;");
  assert.equal(result.dialect, "mysql");
  assert.ok(result.diagnostics.length > 0);
  assert.equal(result.diagnostics[0].severity, "error");
  assert.ok(result.diagnostics[0].startLineNumber >= 1);
  assert.ok(result.diagnostics[0].startColumn >= 1);
});

test("parser exposes valid statement boundaries and entities", () => {
  const service = new MySqlQueryLanguageService();
  const sql = "SELECT c.id FROM customers c;";
  const result = service.parse(sql, { lineNumber: 1, column: 20 });
  assert.equal(result.diagnostics.length, 0);
  assert.equal(result.statements.length, 1);
  assert.match(result.statements[0].text, /SELECT c\.id/u);
  assert.ok(result.entities.some((entity) => entity.name === "customers"));
});

test("completion combines grammar candidates with live catalogue relations", () => {
  const service = new MySqlQueryLanguageService();
  const sql = "SELECT * FROM ";
  const items = service.complete(sql, { lineNumber: 1, column: sql.length + 1 }, catalog);
  assert.ok(items.some((item) => item.kind === "table" && item.label === "customers"));
  assert.ok(items.some((item) => item.kind === "view" && item.label === "active_customers"));
});

test("qualified completion narrows live columns to the referenced relation", () => {
  const service = new MySqlQueryLanguageService();
  const sql = "SELECT customers. FROM customers";
  const position = { lineNumber: 1, column: "SELECT customers.".length + 1 };
  const items = service.complete(sql, position, catalog);
  assert.ok(items.some((item) => item.kind === "column" && item.label === "email"));
  assert.ok(!items.some((item) => item.kind === "view"));
});

test("provider resolver is dialect aware and rejects unsupported providers", () => {
  assert.equal(createQueryLanguageService("MySQL").dialect, "mysql");
  assert.equal(createQueryLanguageService("mariadb").dialect, "mysql");
  assert.throws(() => createQueryLanguageService("oracle"), /does not yet support/u);
});

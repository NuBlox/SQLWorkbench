import assert from "node:assert/strict";
import test from "node:test";

import { splitSqlScript, statementAtOffset } from "../dist/electron/lib/sql-text.js";

test("splits SQL scripts only at statement delimiters outside strings and comments", () => {
  const sql = [
    "SELECT ';' AS literal;",
    "-- semicolon ; inside a comment",
    "SELECT 2 AS value;",
    "/* another ; comment */ SELECT `semi;column` FROM demo;",
  ].join("\n");

  const segments = splitSqlScript(sql);
  assert.equal(segments.length, 3);
  assert.equal(segments[0].text, "SELECT ';' AS literal");
  assert.match(segments[1].text, /SELECT 2 AS value/);
  assert.match(segments[2].text, /SELECT `semi;column` FROM demo/);
});

test("finds the statement under the editor cursor", () => {
  const sql = "SELECT 1;\n\nSELECT 2;\nSELECT 3";
  const offset = sql.indexOf("2");
  assert.equal(statementAtOffset(sql, offset)?.text, "SELECT 2");
});

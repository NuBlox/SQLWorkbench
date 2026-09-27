import assert from "node:assert/strict";
import test from "node:test";

import { serializeResultSetCsv, serializeResultSetJson } from "../dist/electron/main/result-export.js";

const resultSet = {
  columns: [{ name: "name" }, { name: "value" }],
  rows: [
    { name: "alpha", value: 1 },
    { name: "comma,value", value: "=SUM(A1:A2)" },
    { name: "quote\"value", value: null },
  ],
};

test("CSV export quotes fields and neutralizes spreadsheet formulas", () => {
  const csv = serializeResultSetCsv(resultSet);
  assert.match(csv, /^name,value\r\n/u);
  assert.match(csv, /"comma,value",'=SUM\(A1:A2\)/u);
  assert.match(csv, /"quote""value",\r\n/u);
});

test("JSON export preserves normalized result values", () => {
  const json = JSON.parse(serializeResultSetJson(resultSet));
  assert.deepEqual(json.rows[0], { name: "alpha", value: 1 });
  assert.equal(json.rows[2].value, null);
});

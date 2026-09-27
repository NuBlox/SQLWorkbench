import assert from "node:assert/strict";
import test from "node:test";

import { qualifiedObjectKey } from "../dist/index.js";

test("qualifiedObjectKey keeps catalog/schema boundaries distinct", () => {
  assert.notEqual(
    qualifiedObjectKey({ catalog: "ab", name: "c" }),
    qualifiedObjectKey({ catalog: "a", schema: "b", name: "c" }),
  );
});

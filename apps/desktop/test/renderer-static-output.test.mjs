import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const rendererEntry = new URL("../build/renderer/index.html", import.meta.url);

test("desktop renderer is prerendered with relative assets and hashed CSP", async () => {
  const html = await readFile(rendererEntry, "utf8");

  assert.match(html, /NuBlox/u);
  assert.match(html, /Connection workspace/u);
  assert.match(html, /_app\/immutable/u);
  assert.doesNotMatch(html, /(?:src|href)=["']\/_app\//u);
  assert.match(html, /http-equiv=["']content-security-policy["']/iu);
  assert.match(html, /script-src/iu);
  assert.match(html, /sha256-[A-Za-z0-9+/=]+/u);
});

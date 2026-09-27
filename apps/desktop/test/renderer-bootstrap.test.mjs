import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { rendererFailureHtml, verifyRendererBootstrap } from "../dist/electron/main/renderer-bootstrap.js";

test("renderer bootstrap accepts built renderer and preload assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nublox-renderer-bootstrap-"));
  try {
    const rendererHtml = join(directory, "index.html");
    const preloadScript = join(directory, "preload.cjs");
    await writeFile(rendererHtml, '<!doctype html><script type="module" src="./app.js"></script>', "utf8");
    await writeFile(preloadScript, '"use strict";', "utf8");
    assert.deepEqual(await verifyRendererBootstrap({ rendererHtml, preloadScript }), { ok: true, errors: [] });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("renderer bootstrap reports missing build artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nublox-renderer-bootstrap-"));
  try {
    const check = await verifyRendererBootstrap({ rendererHtml: join(directory, "missing-index.html"), preloadScript: join(directory, "missing-preload.cjs") });
    assert.equal(check.ok, false);
    assert.equal(check.errors.length, 2);
    assert.match(check.errors[0] ?? "", /Missing renderer HTML/u);
    assert.match(check.errors[1] ?? "", /Missing preload script/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("renderer failure page escapes diagnostic content", () => {
  const html = rendererFailureHtml("Renderer <failed>", ["bad <script>alert('x')</script>"]);
  assert.match(html, /Renderer &lt;failed&gt;/u);
  assert.match(html, /bad &lt;script&gt;alert\(&#039;x&#039;\)&lt;\/script&gt;/u);
  assert.doesNotMatch(html, /<script>alert/u);
});

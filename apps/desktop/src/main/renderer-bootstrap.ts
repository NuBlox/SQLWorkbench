import { access, readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

export interface RendererBootstrapPaths {
  readonly rendererHtml: string;
  readonly preloadScript: string;
}

export interface RendererBootstrapCheck {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export async function verifyRendererBootstrap(paths: RendererBootstrapPaths): Promise<RendererBootstrapCheck> {
  const errors: string[] = [];
  await Promise.all([
    verifyFile(paths.rendererHtml, "renderer HTML", errors),
    verifyFile(paths.preloadScript, "preload script", errors),
  ]);
  if (errors.length === 0) {
    try {
      const html = await readFile(paths.rendererHtml, "utf8");
      if (!/<(?:script|link)\b/iu.test(html)) errors.push(`Renderer HTML '${paths.rendererHtml}' does not reference any client assets.`);
    } catch (error) {
      errors.push(`Unable to inspect renderer HTML '${paths.rendererHtml}': ${message(error)}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function resolveRendererAssetPath(rendererRoot: string, requestUrl: string): string | undefined {
  try {
    const url = new URL(requestUrl);
    if (url.protocol !== "nublox:" || url.host !== "app") return undefined;

    const pathname = decodeURIComponent(url.pathname);
    const requestedPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (!requestedPath || requestedPath.includes("\0")) return undefined;

    const root = resolve(rendererRoot);
    const candidate = resolve(root, requestedPath);
    const relativePath = relative(root, candidate);
    if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return undefined;
    return candidate;
  } catch {
    return undefined;
  }
}

async function verifyFile(path: string, label: string, errors: string[]): Promise<void> {
  try { await access(path); }
  catch (error) { errors.push(`Missing ${label} at '${path}': ${message(error)}`); }
}

export function rendererFailureHtml(title: string, details: readonly string[]): string {
  const detailMarkup = details.length > 0
    ? `<ul>${details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join("")}</ul>`
    : "<p>No additional diagnostic information was reported.</p>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>NuBlox SQL Workbench startup error</title><style>html,body{margin:0;min-height:100%;background:#08111f;color:#dbe7f5;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{display:grid;place-items:center;padding:32px}.card{width:min(760px,100%);border:1px solid #2a3a50;border-radius:12px;background:#0e1a2a;padding:28px}h1{margin:0 0 10px;font-size:22px;color:#f2f7fd}p,li{color:#9db0c5;line-height:1.5}code{color:#b8d7ff}.hint{margin-top:20px;border-top:1px solid #223247;padding-top:16px;color:#7f95ad;font-size:13px}</style></head><body><main class="card"><h1>${escapeHtml(title)}</h1>${detailMarkup}<p class="hint">Run <code>pnpm --filter @nublox/sql-workbench-desktop build</code> and restart the application. The same diagnostics are also written to the terminal and startup.log.</p></main></body></html>`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

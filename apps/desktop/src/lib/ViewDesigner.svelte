<script lang="ts">
  import { onMount } from "svelte";
  import type { ConnectionProfile } from "@nublox/workbench-connection-profiles";
  import SqlEditor from "$lib/SqlEditor.svelte";
  import type {
    DatabaseViewAlgorithm,
    DatabaseViewChangePlan,
    DatabaseViewCheckOption,
    DatabaseViewDefinition,
    DatabaseViewSecurityType,
    ExplorerNamespace,
    ExplorerRelation,
    OpenConnectionInfo,
    ViewPreparedPreview,
  } from "$lib/desktop-api";

  let profiles: readonly ConnectionProfile[] = [];
  let connections: readonly OpenConnectionInfo[] = [];
  let connectionId = "";
  let namespaces: readonly ExplorerNamespace[] = [];
  let namespaceKey = "";
  let views: readonly ExplorerRelation[] = [];
  let viewKey = "";
  let live: DatabaseViewDefinition | undefined;
  let selectSql = "";
  let algorithm: DatabaseViewAlgorithm = "undefined";
  let securityType: DatabaseViewSecurityType = "definer";
  let checkOption: DatabaseViewCheckOption = "none";
  let definer = "";
  let prepared: ViewPreparedPreview | undefined;
  let confirmation = "";
  let busy = false;
  let executing = false;
  let errorMessage = "";
  let notice = "Select an open connection and view to edit its definition.";

  $: selectedNamespace = namespaces.find((item) => item.key === namespaceKey);
  $: selectedView = views.find((item) => item.key === viewKey);
  $: selectedProfile = profiles.find((item) => item.id === connectionId);

  onMount(() => { void refreshConnections(); });

  async function refreshConnections(): Promise<void> {
    await runBusy(async () => {
      [profiles, connections] = await Promise.all([
        window.nublox.profiles.list(),
        window.nublox.connections.list(),
      ]);
      if (!connections.some((item) => item.profileId === connectionId)) connectionId = connections[0]?.profileId ?? "";
      await loadNamespaces();
    });
  }

  async function loadNamespaces(): Promise<void> {
    namespaces = [];
    views = [];
    namespaceKey = "";
    viewKey = "";
    resetEditor();
    if (!connectionId) return;
    namespaces = await window.nublox.explorer.namespaces({ connectionId, includeSystem: false });
    namespaceKey = namespaces[0]?.key ?? "";
    await loadViews();
  }

  async function loadViews(): Promise<void> {
    views = [];
    viewKey = "";
    resetEditor();
    if (!selectedNamespace) return;
    const relations = await window.nublox.explorer.relations(namespaceRequest());
    views = relations.filter((item) => item.kind === "view");
    viewKey = views[0]?.key ?? "";
  }

  async function loadView(): Promise<void> {
    if (!selectedView) return;
    await runBusy(async () => {
      const loaded = await window.nublox.views.load(viewRequest());
      setLive(loaded);
      notice = `Loaded ${qualified(selectedView!)} from the live database.`;
    });
  }

  async function generatePreview(): Promise<void> {
    if (!live || !selectedView) return;
    await runBusy(async () => {
      prepared = await window.nublox.views.preview({ ...viewRequest(), draft: draft() });
      confirmation = "";
      notice = "Regenerated ALTER VIEW from current live metadata.";
    });
  }

  async function applyView(): Promise<void> {
    if (!prepared || !selectedView) return;
    executing = true;
    errorMessage = "";
    try {
      const result = await window.nublox.views.execute({
        ...viewRequest(),
        draft: draft(),
        fingerprint: prepared.guard.fingerprint,
        confirmation,
      });
      if (!result.completed) {
        errorMessage = `View execution stopped after ${result.executedStatements}/${result.totalStatements}: ${result.error ?? "database error"}`;
        if (result.refreshedView) setLive(result.refreshedView);
        return;
      }
      if (result.refreshedView) setLive(result.refreshedView);
      prepared = undefined;
      confirmation = "";
      notice = `Applied ${result.executedStatements}/${result.totalStatements} view statement and refreshed live metadata.`;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      executing = false;
    }
  }

  function draft(): DatabaseViewChangePlan {
    if (!live) throw new Error("Load a live view first.");
    return {
      ...(live.catalog ? { catalog: live.catalog } : {}),
      ...(live.schema ? { schema: live.schema } : {}),
      name: live.name,
      selectSql,
      algorithm,
      ...(definer.trim() ? { definer: definer.trim() } : {}),
      securityType,
      checkOption,
    };
  }

  function setLive(value: DatabaseViewDefinition): void {
    live = value;
    selectSql = value.selectSql;
    algorithm = value.algorithm;
    securityType = value.securityType;
    checkOption = value.checkOption;
    definer = value.definer ?? "";
    prepared = undefined;
    confirmation = "";
  }

  function invalidate(): void {
    prepared = undefined;
    confirmation = "";
  }

  function resetEditor(): void {
    live = undefined;
    selectSql = "";
    algorithm = "undefined";
    securityType = "definer";
    checkOption = "none";
    definer = "";
    prepared = undefined;
    confirmation = "";
  }

  function namespaceRequest() {
    if (!selectedNamespace) throw new Error("Select a database or schema first.");
    return {
      connectionId,
      ...(selectedNamespace.catalog ? { catalog: selectedNamespace.catalog } : {}),
      ...(selectedNamespace.schema ? { schema: selectedNamespace.schema } : {}),
      includeSystem: false,
    };
  }

  function viewRequest() {
    if (!selectedView) throw new Error("Select a view first.");
    return {
      connectionId,
      ...(selectedView.catalog ? { catalog: selectedView.catalog } : {}),
      ...(selectedView.schema ? { schema: selectedView.schema } : {}),
      name: selectedView.name,
      includeSystem: false,
    };
  }

  function qualified(view: ExplorerRelation): string {
    return [view.catalog, view.schema, view.name].filter(Boolean).join(".");
  }

  async function runBusy(action: () => Promise<void>): Promise<void> {
    busy = true;
    errorMessage = "";
    try { await action(); }
    catch (error) { errorMessage = error instanceof Error ? error.message : String(error); notice = "View action failed."; }
    finally { busy = false; }
  }
</script>

<section class="view-shell">
  <aside class="panel source-panel">
    <header><div><h2>Live view</h2><p>Select an existing database view.</p></div><button onclick={refreshConnections} disabled={busy}>↻</button></header>
    <div class="selectors">
      <label><span>Connection</span><select bind:value={connectionId} onchange={loadNamespaces}><option value="">Select connection</option>{#each connections as connection}<option value={connection.profileId}>{profiles.find((item) => item.id === connection.profileId)?.name ?? connection.profileId}</option>{/each}</select></label>
      <label><span>Database / schema</span><select bind:value={namespaceKey} onchange={loadViews} disabled={!connectionId}><option value="">Select namespace</option>{#each namespaces as namespace}<option value={namespace.key}>{namespace.label}</option>{/each}</select></label>
      <label><span>View</span><select bind:value={viewKey} onchange={resetEditor} disabled={!namespaceKey}><option value="">Select view</option>{#each views as view}<option value={view.key}>{view.name}</option>{/each}</select></label>
      <button class="primary" onclick={loadView} disabled={busy || !selectedView}>Load definition</button>
    </div>
    {#if selectedProfile}<div class="source-meta"><span>{selectedProfile.host}:{selectedProfile.port ?? 3306}</span><span>{views.length} views</span></div>{/if}
  </aside>

  <section class="panel editor-panel">
    <header><div><h2>View definition</h2><p>Edit the canonical query while preserving live provider metadata.</p></div>{#if live}<code>{[live.catalog, live.schema, live.name].filter(Boolean).join(".")}</code>{/if}</header>
    {#if !live}
      <div class="empty"><strong>No view loaded</strong><p>Select a view and load its live definition.</p></div>
    {:else}
      <div class="metadata">
        <label><span>Algorithm</span><select bind:value={algorithm} onchange={invalidate}><option value="undefined">UNDEFINED</option><option value="merge">MERGE</option><option value="temptable">TEMPTABLE</option></select></label>
        <label><span>SQL security</span><select bind:value={securityType} onchange={invalidate}><option value="definer">DEFINER</option><option value="invoker">INVOKER</option></select></label>
        <label><span>Check option</span><select bind:value={checkOption} onchange={invalidate}><option value="none">NONE</option><option value="cascaded">CASCADED</option><option value="local">LOCAL</option></select></label>
        <label><span>Definer</span><input value={definer} readonly title="Preserved from the live view" /></label>
      </div>
      <div class="updatable">Live status: <strong>{live.updatable === undefined ? "unknown" : live.updatable ? "updatable" : "read-only"}</strong></div>
      <div class="sql-editor" oninput={invalidate}><SqlEditor bind:value={selectSql} /></div>
      <footer><button class="primary" onclick={generatePreview} disabled={busy || !selectSql.trim()}>Preview ALTER VIEW</button><span>Preview is regenerated against the current live view.</span></footer>
    {/if}
  </section>

  <section class="panel preview-panel">
    <header><div><h2>Guarded DDL</h2><p>Review the exact provider statement before applying.</p></div>{#if prepared}<code>{prepared.guard.fingerprint.slice(0, 12)}</code>{/if}</header>
    {#if !prepared}
      <div class="empty"><strong>No preview generated</strong><p>Load and edit a view, then generate the provider DDL.</p></div>
    {:else}
      {#if prepared.preview.warnings.length}<div class="warnings">{#each prepared.preview.warnings as warning}<p>{warning}</p>{/each}</div>{/if}
      <pre>{prepared.preview.statements.join("\n\n")}</pre>
      <div class="guard">
        <p>Type <code>{prepared.guard.confirmationPhrase}</code> to enable execution.</p>
        <input bind:value={confirmation} placeholder={prepared.guard.confirmationPhrase} autocomplete="off" />
        <button class="danger" onclick={applyView} disabled={executing || confirmation.trim() !== prepared.guard.confirmationPhrase}>{executing ? "Applying…" : "Apply live view change"}</button>
      </div>
    {/if}
  </section>
</section>

<footer class="activity-bar" class:error={Boolean(errorMessage)}><span class="activity-indicator"></span><span>{errorMessage || notice}</span>{#if busy}<span>Working…</span>{/if}</footer>

<style>
  .view-shell{flex:1;min-height:0;display:grid;grid-template-columns:280px minmax(520px,1.4fr) minmax(360px,.9fr);gap:14px;padding:18px 20px}.panel{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid #1e3044;border-radius:11px;background:rgba(13,25,41,.86)}header{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 15px;border-bottom:1px solid #1b2c3f}header h2{margin:0 0 3px;color:#edf5fd;font-size:13px}header p{margin:0;color:#71869e;font-size:9px}header code{color:#7fb0f5;font-size:9px}.selectors{display:grid;gap:11px;padding:15px}.selectors label>span,.metadata label>span{display:block;margin-bottom:5px;color:#7087a1;font-size:8px;text-transform:uppercase}.selectors select,.metadata select,.metadata input,.guard input{width:100%;border:1px solid #263a52;border-radius:6px;padding:8px;background:#0b1726;color:#dbe7f5;outline:none}.primary,.danger,header button{cursor:pointer}.primary{border:1px solid #4a86dd;border-radius:7px;padding:8px 11px;background:#3477d8;color:#fff;font-size:9px;font-weight:650}.danger{border:1px solid #a84c55;border-radius:7px;padding:8px 11px;background:#6d2730;color:#fff;font-size:9px;font-weight:650}.source-meta{margin-top:auto;display:flex;justify-content:space-between;padding:12px 15px;border-top:1px solid #1b2c3f;color:#6f8299;font-size:9px}.metadata{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;padding:12px 14px;border-bottom:1px solid #1b2c3f}.updatable{padding:8px 14px;color:#7890aa;font-size:9px;border-bottom:1px solid #1b2c3f}.sql-editor{flex:1;min-height:320px}.editor-panel footer{display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid #1b2c3f}.editor-panel footer span{color:#6f8299;font-size:9px}.empty{margin:auto;padding:24px;text-align:center;color:#6e849e}.empty strong{display:block;color:#b8c8da;font-size:12px}.empty p{font-size:10px}.preview-panel pre{flex:1;min-height:180px;margin:0;padding:14px;overflow:auto;background:#08111d;color:#b9d6f5;font:10px/1.55 SFMono-Regular,Menlo,monospace;white-space:pre-wrap}.warnings{padding:9px 13px;border-bottom:1px solid #50383d;background:#21171c;color:#d99ca3;font-size:9px}.warnings p{margin:3px 0}.guard{display:grid;gap:8px;padding:13px;border-top:1px solid #1b2c3f}.guard p{margin:0;color:#8195ad;font-size:9px}.guard code{color:#efb4b9}.activity-bar{min-height:34px;display:flex;gap:8px;align-items:center;padding:0 21px;border-top:1px solid #17273a;color:#7890aa;font-size:9px}.activity-bar.error{color:#e4959e}.activity-indicator{width:6px;height:6px;border-radius:50%;background:#4c8adf}@media(max-width:1250px){.view-shell{grid-template-columns:250px 1fr}.preview-panel{grid-column:1/-1;min-height:300px}.metadata{grid-template-columns:repeat(2,1fr)}}
</style>

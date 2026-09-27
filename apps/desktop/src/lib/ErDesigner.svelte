<script lang="ts">
  import { onMount } from "svelte";
  import type { ConnectionProfile } from "@nublox/workbench-connection-profiles";
  import type {
    DatabaseReferentialAction,
    DependencyGraph,
    ErPreparedPreview,
    ErRelationshipRequest,
    ExplorerNamespace,
    ExplorerRelation,
    ExplorerRelationDetails,
    OpenConnectionInfo,
  } from "$lib/desktop-api";

  interface Point { x: number; y: number; }
  interface DragState { id: string; pointerX: number; pointerY: number; origin: Point; }

  let profiles: readonly ConnectionProfile[] = [];
  let connections: readonly OpenConnectionInfo[] = [];
  let connectionId = "";
  let namespaces: readonly ExplorerNamespace[] = [];
  let namespaceKey = "";
  let relations: readonly ExplorerRelation[] = [];
  let graph: DependencyGraph | undefined;
  let positions: Record<string, Point> = {};
  let drag: DragState | undefined;
  let sourceKey = "";
  let targetKey = "";
  let sourceDetails: ExplorerRelationDetails | undefined;
  let targetDetails: ExplorerRelationDetails | undefined;
  let operation: "add" | "drop" = "add";
  let sourceColumn = "";
  let targetColumn = "";
  let foreignKey = "";
  let onDelete: DatabaseReferentialAction = "restrict";
  let prepared: ErPreparedPreview | undefined;
  let confirmation = "";
  let busy = false;
  let executing = false;
  let errorMessage = "";
  let notice = "Select an open connection and namespace to model relationships.";

  $: selectedNamespace = namespaces.find((item) => item.key === namespaceKey);
  $: sourceRelation = relations.find((item) => item.key === sourceKey);
  $: targetRelation = relations.find((item) => item.key === targetKey);
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
    namespaceKey = "";
    resetModel();
    if (!connectionId) return;
    namespaces = await window.nublox.explorer.namespaces({ connectionId, includeSystem: false });
    namespaceKey = namespaces[0]?.key ?? "";
    await loadGraph();
  }

  async function loadGraph(): Promise<void> {
    resetModel();
    if (!selectedNamespace) return;
    await runBusy(async () => {
      relations = (await window.nublox.explorer.relations(namespaceRequest())).filter((item) => item.kind === "table");
      graph = await window.nublox.schema.graph(namespaceRequest());
      positions = layout(graph);
      sourceKey = relations[0]?.key ?? "";
      targetKey = relations[1]?.key ?? relations[0]?.key ?? "";
      await loadSource();
      await loadTarget();
      notice = `Loaded ${graph.nodes.length} objects and ${graph.edges.length} live relationships.`;
    });
  }

  async function loadSource(): Promise<void> {
    invalidatePreview();
    sourceDetails = sourceRelation ? await window.nublox.explorer.describe(relationRequest(sourceRelation)) : undefined;
    sourceColumn = sourceDetails?.columns[0]?.name ?? "";
    foreignKey = defaultForeignKey();
  }

  async function loadTarget(): Promise<void> {
    invalidatePreview();
    targetDetails = targetRelation ? await window.nublox.explorer.describe(relationRequest(targetRelation)) : undefined;
    targetColumn = targetDetails?.columns.find((item) => item.name === "id")?.name ?? targetDetails?.columns[0]?.name ?? "";
    foreignKey = defaultForeignKey();
  }

  async function selectNode(id: string): Promise<void> {
    const relation = relations.find((item) => item.key === id);
    if (!relation) return;
    sourceKey = relation.key;
    await runBusy(loadSource);
  }

  function beginDrag(id: string, event: PointerEvent): void {
    const origin = positions[id];
    if (!origin) return;
    drag = { id, pointerX: event.clientX, pointerY: event.clientY, origin };
    event.preventDefault();
  }

  function moveDrag(event: PointerEvent): void {
    if (!drag) return;
    positions = {
      ...positions,
      [drag.id]: {
        x: Math.max(10, drag.origin.x + event.clientX - drag.pointerX),
        y: Math.max(10, drag.origin.y + event.clientY - drag.pointerY),
      },
    };
  }

  function endDrag(): void { drag = undefined; }

  async function previewRelationship(): Promise<void> {
    if (!sourceRelation) return;
    await runBusy(async () => {
      prepared = await window.nublox.er.preview(relationshipRequest());
      confirmation = "";
      notice = `${operation === "add" ? "Add" : "Drop"} relationship DDL regenerated from live metadata.`;
    });
  }

  async function applyRelationship(): Promise<void> {
    if (!prepared) return;
    executing = true;
    errorMessage = "";
    try {
      const result = await window.nublox.er.execute({
        ...relationshipRequest(),
        fingerprint: prepared.guard.fingerprint,
        confirmation,
      });
      if (!result.completed) {
        errorMessage = `ER execution stopped after ${result.executedStatements}/${result.totalStatements}: ${result.error ?? "database error"}`;
        return;
      }
      prepared = undefined;
      confirmation = "";
      await loadGraph();
      notice = `Applied ${result.executedStatements}/${result.totalStatements} relationship statement and refreshed the live ER model.`;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      executing = false;
    }
  }

  function relationshipRequest(): ErRelationshipRequest {
    if (!sourceRelation) throw new Error("Select a source table.");
    const base = {
      ...namespaceRequest(),
      sourceTable: sourceRelation.name,
      foreignKey: foreignKey.trim(),
    };
    if (operation === "drop") return { ...base, operation: "drop" };
    if (!targetRelation) throw new Error("Select a target table.");
    return {
      ...base,
      operation: "add",
      sourceColumns: [sourceColumn],
      targetTable: targetRelation.name,
      targetColumns: [targetColumn],
      onDelete,
    };
  }

  function setOperation(value: "add" | "drop"): void {
    operation = value;
    if (value === "drop") foreignKey = sourceDetails?.foreignKeys[0]?.name ?? "";
    else foreignKey = defaultForeignKey();
    invalidatePreview();
  }

  function defaultForeignKey(): string {
    if (!sourceRelation || !targetRelation) return "";
    return `fk_${sourceRelation.name}_${targetRelation.name}`.replace(/[^A-Za-z0-9_]+/g, "_").slice(0, 64);
  }

  function invalidatePreview(): void { prepared = undefined; confirmation = ""; }

  function resetModel(): void {
    relations = [];
    graph = undefined;
    positions = {};
    sourceKey = "";
    targetKey = "";
    sourceDetails = undefined;
    targetDetails = undefined;
    sourceColumn = "";
    targetColumn = "";
    foreignKey = "";
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

  function relationRequest(relation: ExplorerRelation) {
    return {
      ...namespaceRequest(),
      name: relation.name,
    };
  }

  function edgeLine(id: string): { x1: number; y1: number; x2: number; y2: number } {
    const edge = graph?.edges.find((item) => item.id === id);
    const from = edge ? positions[edge.from] : undefined;
    const to = edge ? positions[edge.to] : undefined;
    return {
      x1: (from?.x ?? 0) + 90,
      y1: (from?.y ?? 0) + 34,
      x2: (to?.x ?? 0) + 90,
      y2: (to?.y ?? 0) + 34,
    };
  }

  function layout(value: DependencyGraph): Record<string, Point> {
    const result: Record<string, Point> = {};
    const columns = 4;
    value.nodes.forEach((node, index) => {
      result[node.id] = { x: 36 + (index % columns) * 245, y: 40 + Math.floor(index / columns) * 150 };
    });
    return result;
  }

  async function runBusy(action: () => Promise<void>): Promise<void> {
    busy = true;
    errorMessage = "";
    try { await action(); }
    catch (error) { errorMessage = error instanceof Error ? error.message : String(error); notice = "ER modelling action failed."; }
    finally { busy = false; }
  }
</script>

<svelte:window onpointermove={moveDrag} onpointerup={endDrag} />

<section class="er-shell">
  <aside class="panel control-panel">
    <header><div><h2>ER model source</h2><p>Load a live namespace and edit relationships.</p></div><button onclick={refreshConnections} disabled={busy}>↻</button></header>
    <div class="selectors">
      <label><span>Connection</span><select bind:value={connectionId} onchange={loadNamespaces}><option value="">Select connection</option>{#each connections as connection}<option value={connection.profileId}>{profiles.find((item) => item.id === connection.profileId)?.name ?? connection.profileId}</option>{/each}</select></label>
      <label><span>Database / schema</span><select bind:value={namespaceKey} onchange={loadGraph} disabled={!connectionId}><option value="">Select namespace</option>{#each namespaces as namespace}<option value={namespace.key}>{namespace.label}</option>{/each}</select></label>
      <button class="secondary" onclick={loadGraph} disabled={busy || !selectedNamespace}>Reload live model</button>
    </div>
    {#if selectedProfile}<div class="source-meta"><span>{selectedProfile.host}:{selectedProfile.port ?? 3306}</span><span>{graph?.edges.length ?? 0} relationships</span></div>{/if}
  </aside>

  <section class="panel canvas-panel">
    <header><div><h2>Interactive ER canvas</h2><p>Drag tables to organise the model. Select a table to edit its foreign keys.</p></div>{#if graph}<span>{graph.nodes.length} objects</span>{/if}</header>
    {#if !graph}
      <div class="empty"><strong>No ER model loaded</strong><p>Select a namespace to begin.</p></div>
    {:else}
      <div class="canvas-scroll">
        <div class="canvas">
          <svg aria-hidden="true" viewBox="0 0 1200 900" preserveAspectRatio="none">
            <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z"></path></marker></defs>
            {#each graph.edges as edge}
              {@const line = edgeLine(edge.id)}
              <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} marker-end="url(#arrow)"></line>
            {/each}
          </svg>
          {#each graph.nodes as node}
            {@const point = positions[node.id] ?? { x: 0, y: 0 }}
            <article class:external={node.external} class:selected={sourceKey === node.id} style={`left:${point.x}px;top:${point.y}px`}>
              <button class="drag-handle" title="Drag table" onpointerdown={(event) => beginDrag(node.id, event)}>⠿</button>
              <button class="node-body" onclick={() => selectNode(node.id)} disabled={node.external}>
                <strong>{node.label}</strong><small>{node.kind}{node.external ? " · external" : ""}</small>
              </button>
              <span>{graph.edges.filter((edge) => edge.from === node.id).length} FK</span>
            </article>
          {/each}
        </div>
      </div>
    {/if}
  </section>

  <aside class="panel relationship-panel">
    <header><div><h2>Relationship editor</h2><p>Create or remove a foreign-key edge.</p></div></header>
    <div class="mode"><button class:active={operation === "add"} onclick={() => setOperation("add")}>Add FK</button><button class:active={operation === "drop"} onclick={() => setOperation("drop")}>Drop FK</button></div>
    <div class="relationship-form">
      <label><span>Source table</span><select bind:value={sourceKey} onchange={() => runBusy(loadSource)}><option value="">Select source</option>{#each relations as relation}<option value={relation.key}>{relation.name}</option>{/each}</select></label>
      {#if operation === "add"}
        <label><span>Source column</span><select bind:value={sourceColumn} onchange={invalidatePreview}>{#each sourceDetails?.columns ?? [] as column}<option value={column.name}>{column.name}</option>{/each}</select></label>
        <label><span>Target table</span><select bind:value={targetKey} onchange={() => runBusy(loadTarget)}><option value="">Select target</option>{#each relations as relation}<option value={relation.key}>{relation.name}</option>{/each}</select></label>
        <label><span>Target column</span><select bind:value={targetColumn} onchange={invalidatePreview}>{#each targetDetails?.columns ?? [] as column}<option value={column.name}>{column.name}</option>{/each}</select></label>
        <label><span>Constraint name</span><input bind:value={foreignKey} oninput={invalidatePreview} /></label>
        <label><span>On delete</span><select bind:value={onDelete} onchange={invalidatePreview}><option value="restrict">RESTRICT</option><option value="cascade">CASCADE</option><option value="detach">DETACH / NO ACTION</option></select></label>
      {:else}
        <label><span>Foreign key</span><select bind:value={foreignKey} onchange={invalidatePreview}><option value="">Select constraint</option>{#each sourceDetails?.foreignKeys ?? [] as fk}<option value={fk.name}>{fk.name} → {fk.referencedTable}</option>{/each}</select></label>
      {/if}
      <button class="primary" onclick={previewRelationship} disabled={busy || !sourceRelation || !foreignKey.trim() || (operation === "add" && (!targetRelation || !sourceColumn || !targetColumn))}>Preview relationship DDL</button>
    </div>

    {#if prepared}
      <div class="preview" class:destructive={prepared.guard.destructive}>
        <div><strong>{prepared.guard.destructive ? "Destructive change" : "Relationship change"}</strong><code>{prepared.guard.fingerprint.slice(0, 12)}</code></div>
        {#each prepared.preview.warnings as warning}<p>{warning}</p>{/each}
        <pre>{prepared.preview.statements.join("\n\n")}</pre>
        <p>Type <code>{prepared.guard.confirmationPhrase}</code></p>
        <input bind:value={confirmation} placeholder={prepared.guard.confirmationPhrase} autocomplete="off" />
        <button class="danger" onclick={applyRelationship} disabled={executing || confirmation.trim() !== prepared.guard.confirmationPhrase}>{executing ? "Applying…" : "Apply relationship"}</button>
      </div>
    {/if}
  </aside>
</section>

<footer class="activity-bar" class:error={Boolean(errorMessage)}><span class="activity-indicator"></span><span>{errorMessage || notice}</span>{#if busy}<span>Working…</span>{/if}</footer>

<style>
  .er-shell{flex:1;min-height:0;display:grid;grid-template-columns:250px minmax(600px,1fr) 310px;gap:14px;padding:18px 20px}.panel{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid #1e3044;border-radius:11px;background:rgba(13,25,41,.86)}header{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:14px 15px;border-bottom:1px solid #1b2c3f}header h2{margin:0 0 3px;color:#edf5fd;font-size:13px}header p{margin:0;color:#71869e;font-size:9px}header span{color:#71869e;font-size:9px}.selectors,.relationship-form{display:grid;gap:10px;padding:14px}.selectors label>span,.relationship-form label>span{display:block;margin-bottom:5px;color:#7087a1;font-size:8px;text-transform:uppercase}.selectors select,.relationship-form select,.relationship-form input,.preview input{width:100%;border:1px solid #263a52;border-radius:6px;padding:8px;background:#0b1726;color:#dbe7f5;outline:none}.primary,.secondary,.danger,header button,.mode button,.node-body,.drag-handle{cursor:pointer}.primary{border:1px solid #4a86dd;border-radius:7px;padding:8px 11px;background:#3477d8;color:#fff;font-size:9px;font-weight:650}.secondary{border:1px solid #304966;border-radius:7px;padding:8px 11px;background:#13243a;color:#abc1da;font-size:9px}.danger{border:1px solid #a84c55;border-radius:7px;padding:8px 11px;background:#6d2730;color:#fff;font-size:9px;font-weight:650}.source-meta{margin-top:auto;display:flex;justify-content:space-between;padding:12px 14px;border-top:1px solid #1b2c3f;color:#6f8299;font-size:9px}.canvas-scroll{flex:1;overflow:auto;background:#08111d}.canvas{position:relative;width:1200px;height:900px;background-image:linear-gradient(#102137 1px,transparent 1px),linear-gradient(90deg,#102137 1px,transparent 1px);background-size:24px 24px}.canvas svg{position:absolute;inset:0;width:1200px;height:900px;pointer-events:none}.canvas line{stroke:#47749e;stroke-width:1.5}.canvas marker path{fill:#47749e}.canvas article{position:absolute;width:180px;min-height:68px;display:grid;grid-template-columns:24px 1fr auto;align-items:stretch;border:1px solid #2b4663;border-radius:8px;background:#102138;box-shadow:0 8px 18px rgba(0,0,0,.16)}.canvas article.selected{border-color:#599cff;box-shadow:0 0 0 2px rgba(89,156,255,.16)}.canvas article.external{opacity:.58;border-style:dashed}.drag-handle{border:0;border-right:1px solid #263b52;background:#0c1a2b;color:#5f7894}.node-body{min-width:0;border:0;padding:10px 8px;background:transparent;color:#dbe7f5;text-align:left}.node-body strong,.node-body small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.node-body strong{font-size:10px}.node-body small{margin-top:5px;color:#66809d;font-size:8px}.canvas article>span{align-self:center;padding-right:7px;color:#6f8fb1;font-size:8px}.mode{display:grid;grid-template-columns:1fr 1fr;padding:10px 14px 0}.mode button{border:1px solid #273d56;padding:7px;background:#0c1929;color:#7f94ad;font-size:9px}.mode button:first-child{border-radius:6px 0 0 6px}.mode button:last-child{border-radius:0 6px 6px 0}.mode button.active{background:#1d3a5d;color:#cfe1f5;border-color:#4678ad}.preview{margin-top:auto;padding:12px;border-top:1px solid #294057;background:#0b1726}.preview.destructive{border-top-color:#78434b;background:#1d1419}.preview>div{display:flex;justify-content:space-between;gap:8px;color:#b7c9dc;font-size:9px}.preview code{color:#7faeef}.preview p{margin:8px 0;color:#8599b1;font-size:8px}.preview pre{max-height:150px;margin:8px 0;padding:8px;overflow:auto;border-radius:5px;background:#07101b;color:#bad8f5;font:8px/1.5 SFMono-Regular,Menlo,monospace;white-space:pre-wrap}.preview .danger{width:100%;margin-top:8px}.empty{margin:auto;padding:24px;text-align:center;color:#6e849e}.empty strong{display:block;color:#b8c8da;font-size:12px}.empty p{font-size:10px}.activity-bar{min-height:34px;display:flex;gap:8px;align-items:center;padding:0 21px;border-top:1px solid #17273a;color:#7890aa;font-size:9px}.activity-bar.error{color:#e4959e}.activity-indicator{width:6px;height:6px;border-radius:50%;background:#4c8adf}@media(max-width:1250px){.er-shell{grid-template-columns:220px 1fr}.relationship-panel{grid-column:1/-1;min-height:350px}}
</style>

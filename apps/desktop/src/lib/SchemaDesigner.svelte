<script lang="ts">
  import { onMount } from "svelte";
  import type { ConnectionProfile } from "@nublox/workbench-connection-profiles";
  import type {
    DependencyGraph,
    ExplorerNamespace,
    ExplorerRelation,
    OpenConnectionInfo,
    SchemaAttributeDraft,
    SchemaDraftInput,
    SchemaDraftView,
    SchemaPreparedPreview,
  } from "$lib/desktop-api";

  interface EditableAttribute {
    name: string;
    physicalColumn: string;
    type: string;
    databaseType: string;
    required: boolean;
    nullable: boolean;
    readOnly: boolean;
    unique: boolean;
  }

  const logicalTypes = ["string", "integer", "number", "decimal", "boolean", "date", "datetime", "uuid", "json", "binary"] as const;

  let profiles: readonly ConnectionProfile[] = [];
  let connections: readonly OpenConnectionInfo[] = [];
  let connectionId = "";
  let namespaces: readonly ExplorerNamespace[] = [];
  let namespaceKey = "";
  let relations: readonly ExplorerRelation[] = [];
  let relationKey = "";
  let draft: SchemaDraftView | undefined;
  let logicalName = "";
  let attributes: EditableAttribute[] = [];
  let prepared: SchemaPreparedPreview | undefined;
  let graph: DependencyGraph | undefined;
  let mode: "migration" | "er" = "migration";
  let confirmation = "";
  let busy = false;
  let executing = false;
  let errorMessage = "";
  let notice = "Select an open connection, database and table to begin schema engineering.";

  $: selectedNamespace = namespaces.find((item) => item.key === namespaceKey);
  $: selectedRelation = relations.find((item) => item.key === relationKey);
  $: selectedProfile = profiles.find((item) => item.id === connectionId);
  $: preview = prepared?.preview;

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

  async function changeConnection(): Promise<void> {
    resetDesign();
    graph = undefined;
    await loadNamespaces();
  }

  async function loadNamespaces(): Promise<void> {
    namespaces = [];
    relations = [];
    namespaceKey = "";
    relationKey = "";
    if (!connectionId) return;
    namespaces = await window.nublox.explorer.namespaces({ connectionId, includeSystem: false });
    namespaceKey = namespaces[0]?.key ?? "";
    await loadRelations();
  }

  async function loadRelations(): Promise<void> {
    relations = [];
    relationKey = "";
    resetDesign();
    graph = undefined;
    if (!connectionId || !selectedNamespace) return;
    relations = await window.nublox.explorer.relations(namespaceRequest());
    const first = relations.find((item) => item.kind === "table") ?? relations[0];
    relationKey = first?.key ?? "";
  }

  async function loadDraft(): Promise<void> {
    if (!selectedRelation) return;
    await runBusy(async () => {
      const loaded = await window.nublox.schema.load(relationRequest());
      setDraft(loaded);
      notice = `Reverse-engineered ${qualified(selectedRelation!)} into ${loaded.objectTypeId}.`;
    });
  }

  async function loadGraph(): Promise<void> {
    if (!selectedNamespace) return;
    mode = "er";
    await runBusy(async () => {
      graph = await window.nublox.schema.graph(namespaceRequest());
      notice = `Loaded ${graph.nodes.length} schema objects and ${graph.edges.length} dependencies.`;
    });
  }

  async function generatePreview(): Promise<void> {
    if (!draft || !selectedRelation) return;
    mode = "migration";
    await runBusy(async () => {
      const result = await window.nublox.schema.preview({ ...relationRequest(), draft: currentDraft() });
      prepared = result;
      confirmation = "";
      const count = result.preview.neutralPlan.operations.length;
      notice = count === 0 ? "Logical draft matches the live physical schema." : `Generated ${count} schema change operation${count === 1 ? "" : "s"}.`;
    });
  }

  async function executeSchema(): Promise<void> {
    if (!draft || !prepared || !selectedRelation) return;
    executing = true;
    errorMessage = "";
    try {
      const result = await window.nublox.schema.execute({
        ...relationRequest(),
        draft: currentDraft(),
        fingerprint: prepared.guard.fingerprint,
        confirmation,
      });
      if (result.refreshedDraft) setDraft(result.refreshedDraft);
      if (!result.completed) {
        errorMessage = `Schema execution stopped after ${result.executedStatements}/${result.totalStatements}: ${result.error ?? "database error"}`;
        return;
      }
      prepared = undefined;
      confirmation = "";
      graph = undefined;
      notice = `Applied ${result.executedStatements}/${result.totalStatements} schema statements and refreshed live metadata.`;
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    } finally {
      executing = false;
    }
  }

  function addAttribute(): void {
    const name = uniqueAttributeName("newAttribute");
    attributes = [...attributes, { name, physicalColumn: toSnakeCase(name), type: "string", databaseType: "varchar(255)", required: false, nullable: true, readOnly: false, unique: false }];
    invalidatePreview();
  }

  function removeAttribute(index: number): void {
    attributes = attributes.filter((_item, offset) => offset !== index);
    invalidatePreview();
  }

  function updateAttribute(index: number, field: keyof EditableAttribute, value: string | boolean): void {
    attributes = attributes.map((attribute, offset) => offset === index ? { ...attribute, [field]: value } : attribute);
    if (field === "nullable" && value === false) attributes = attributes.map((attribute, offset) => offset === index ? { ...attribute, required: true } : attribute);
    if (field === "required" && value === true) attributes = attributes.map((attribute, offset) => offset === index ? { ...attribute, nullable: false } : attribute);
    invalidatePreview();
  }

  function currentDraft(): SchemaDraftInput {
    if (!draft) throw new Error("Load a schema draft first.");
    return {
      ...draft,
      logicalName: logicalName.trim(),
      attributes: attributes.map((attribute): SchemaAttributeDraft => ({
        name: attribute.name.trim(),
        physicalColumn: attribute.physicalColumn.trim(),
        type: attribute.type,
        ...(attribute.databaseType.trim() ? { databaseType: attribute.databaseType.trim() } : {}),
        required: attribute.required,
        nullable: attribute.nullable,
        readOnly: attribute.readOnly,
        unique: attribute.unique,
      })),
    };
  }

  function relationRequest() {
    if (!selectedRelation) throw new Error("Select a table or view first.");
    return {
      connectionId,
      ...(selectedRelation.catalog ? { catalog: selectedRelation.catalog } : {}),
      ...(selectedRelation.schema ? { schema: selectedRelation.schema } : {}),
      name: selectedRelation.name,
      includeSystem: false,
    };
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

  function setDraft(value: SchemaDraftView): void {
    draft = value;
    logicalName = value.logicalName;
    attributes = value.attributes.map(editableAttribute);
    prepared = undefined;
    confirmation = "";
  }

  function editableAttribute(attribute: SchemaAttributeDraft): EditableAttribute {
    return { name: attribute.name, physicalColumn: attribute.physicalColumn, type: attribute.type, databaseType: attribute.databaseType ?? "", required: attribute.required, nullable: attribute.nullable, readOnly: attribute.readOnly, unique: attribute.unique };
  }

  function invalidatePreview(): void { prepared = undefined; confirmation = ""; }
  function resetDesign(): void { draft = undefined; logicalName = ""; attributes = []; prepared = undefined; confirmation = ""; }
  function qualified(relation: ExplorerRelation): string { return [relation.catalog, relation.schema, relation.name].filter(Boolean).join("."); }
  function toSnakeCase(value: string): string { return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toLowerCase(); }
  function nodeName(id: string): string { return graph?.nodes.find((node) => node.id === id)?.label ?? id; }
  function uniqueAttributeName(base: string): string {
    const used = new Set(attributes.map((item) => item.name));
    if (!used.has(base)) return base;
    let suffix = 2;
    while (used.has(`${base}${suffix}`)) suffix += 1;
    return `${base}${suffix}`;
  }

  async function runBusy(action: () => Promise<void>): Promise<void> {
    busy = true;
    errorMessage = "";
    try { await action(); }
    catch (error) { errorMessage = error instanceof Error ? error.message : String(error); notice = "Schema action failed."; }
    finally { busy = false; }
  }
</script>

<section class="designer-shell">
  <aside class="panel source-panel">
    <header><div><h2>Live schema source</h2><p>Choose a connected database object.</p></div><button onclick={refreshConnections} disabled={busy}>↻</button></header>
    <div class="selectors">
      <label><span>Connection</span><select bind:value={connectionId} onchange={changeConnection}><option value="">Select connection</option>{#each connections as connection}<option value={connection.profileId}>{profiles.find((item) => item.id === connection.profileId)?.name ?? connection.profileId}</option>{/each}</select></label>
      <label><span>Database / schema</span><select bind:value={namespaceKey} onchange={loadRelations} disabled={!connectionId}><option value="">Select namespace</option>{#each namespaces as namespace}<option value={namespace.key}>{namespace.label}</option>{/each}</select></label>
      <label><span>Table / view</span><select bind:value={relationKey} onchange={resetDesign} disabled={!namespaceKey}><option value="">Select object</option>{#each relations as relation}<option value={relation.key}>{relation.name} · {relation.kind}</option>{/each}</select></label>
      <button class="primary" onclick={loadDraft} disabled={busy || !selectedRelation}>Reverse engineer</button>
      <button class="secondary" onclick={loadGraph} disabled={busy || !selectedNamespace}>ER dependency model</button>
    </div>
    {#if selectedProfile}<div class="source-meta"><span>{selectedProfile.host}:{selectedProfile.port ?? 3306}</span><span>{selectedRelation ? qualified(selectedRelation) : "No object selected"}</span></div>{/if}
  </aside>

  <section class="panel design-panel">
    <header><div><h2>Logical schema draft</h2><p>Edit logical metadata while physical mappings remain explicit.</p></div>{#if draft}<code>{draft.objectTypeId}</code>{/if}</header>
    {#if !draft}
      <div class="empty"><strong>No schema draft loaded</strong><p>Reverse-engineer a table or view to begin.</p></div>
    {:else}
      <div class="object-row"><label><span>Logical object name</span><input bind:value={logicalName} oninput={invalidatePreview} /></label><div><span>{draft.kind}</span><span>PK {draft.primaryKey.join(", ") || "none"}</span><span>{draft.relationships.length} relationships</span></div></div>
      <div class="attribute-toolbar"><strong>Attributes</strong><button class="secondary" onclick={addAttribute}>+ Add</button></div>
      <div class="attribute-head"><span>Logical</span><span>Physical</span><span>Type</span><span>Database type</span><span>Flags</span><span></span></div>
      <div class="attributes">
        {#each attributes as attribute, index (`${attribute.name}:${index}`)}
          <div class="attribute-row">
            <input value={attribute.name} oninput={(event) => updateAttribute(index, "name", event.currentTarget.value)} />
            <input value={attribute.physicalColumn} oninput={(event) => updateAttribute(index, "physicalColumn", event.currentTarget.value)} />
            <select value={attribute.type} onchange={(event) => updateAttribute(index, "type", event.currentTarget.value)}>{#each logicalTypes as type}<option value={type}>{type}</option>{/each}</select>
            <input value={attribute.databaseType} placeholder="provider default" oninput={(event) => updateAttribute(index, "databaseType", event.currentTarget.value)} />
            <div class="flags"><label><input type="checkbox" checked={attribute.required} onchange={(event) => updateAttribute(index, "required", event.currentTarget.checked)} />req</label><label><input type="checkbox" checked={attribute.nullable} onchange={(event) => updateAttribute(index, "nullable", event.currentTarget.checked)} />null</label><label><input type="checkbox" checked={attribute.unique} onchange={(event) => updateAttribute(index, "unique", event.currentTarget.checked)} />uniq</label>{#if attribute.readOnly}<small>read-only</small>{/if}</div>
            <button class="remove" onclick={() => removeAttribute(index)}>×</button>
          </div>
        {/each}
      </div>
      <footer><button class="primary" onclick={generatePreview} disabled={busy || !logicalName.trim() || attributes.length === 0}>Compare & preview</button><span>Every preview starts from current live metadata.</span></footer>
    {/if}
  </section>

  <section class="panel result-panel">
    <header><div><h2>{mode === "migration" ? "Schema diff & DDL" : "ER dependency model"}</h2><p>{mode === "migration" ? "Preview and guarded execution." : "Namespace foreign-key dependencies."}</p></div><div class="tabs"><button class:active={mode === "migration"} onclick={() => (mode = "migration")}>Migration</button><button class:active={mode === "er"} onclick={loadGraph}>ER</button></div></header>

    {#if mode === "er"}
      {#if !graph}<div class="empty"><strong>No graph loaded</strong><p>Load the selected namespace dependency model.</p></div>{:else}<div class="graph">{#each graph.nodes as node}<article class:external={node.external}><div><strong>{node.label}</strong><small>{node.kind}{node.external ? " · external" : ""}</small></div>{#each graph.edges.filter((edge) => edge.from === node.id) as edge}<p>→ {nodeName(edge.to)} <small>{edge.foreignKey}</small></p>{/each}</article>{/each}</div>{/if}
    {:else if !prepared}
      <div class="empty"><strong>No migration preview</strong><p>Edit the draft and compare it with the live schema.</p></div>
    {:else}
      <div class="risk"><span class:destructive={prepared.guard.destructive}>{prepared.guard.destructive ? "Destructive" : "Non-destructive"}</span><code>{prepared.guard.fingerprint.slice(0, 12)}</code></div>
      <div class="summary"><div><small>Differences</small><strong>{preview?.differences.length ?? 0}</strong></div><div><small>Operations</small><strong>{preview?.neutralPlan.operations.length ?? 0}</strong></div><div><small>Provider</small><strong>{preview?.providerPreview.providerId ?? "—"}</strong></div></div>
      {#if preview?.providerPreview.warnings.length}<div class="warnings">{#each preview.providerPreview.warnings as warning}<p>{warning}</p>{/each}</div>{/if}
      <div class="diffs">{#each preview?.differences ?? [] as difference}<div><strong>{difference.kind}</strong><code>{difference.path}</code></div>{/each}{#if preview?.differences.length === 0}<p>Live schema and logical draft match.</p>{/if}</div>
      <pre>{preview?.providerPreview.statements.length ? preview.providerPreview.statements.join("\n\n") : "-- No schema changes required."}</pre>
      {#if preview && preview.providerPreview.statements.length > 0}
        <div class="guard"><label><span>Type exactly to execute</span><code>{prepared.guard.confirmationPhrase}</code><input bind:value={confirmation} placeholder="Confirmation phrase" /></label><button class:dangerous={prepared.guard.destructive} onclick={executeSchema} disabled={executing || confirmation !== prepared.guard.confirmationPhrase}>{executing ? "Applying…" : "Apply live schema changes"}</button><p>The main process re-reads the live schema and rejects a stale fingerprint before executing any DDL.</p></div>
      {/if}
    {/if}
  </section>
</section>

<div class="activity" class:error={Boolean(errorMessage)}><span></span><p>{errorMessage || notice}</p>{#if busy || executing}<small>Working…</small>{/if}</div>

<style>
  .designer-shell{flex:1;min-height:0;display:grid;grid-template-columns:280px minmax(520px,1.4fr) minmax(360px,.9fr);gap:14px;padding:18px 20px}.panel{min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;border:1px solid #1e3044;border-radius:11px;background:rgba(13,25,41,.88)}header{display:flex;justify-content:space-between;gap:12px;align-items:center;padding:14px 15px;border-bottom:1px solid #1b2c3f}h2{margin:0 0 3px;color:#eef5fd;font-size:13px}header p{margin:0;color:#71869e;font-size:9px}header>code{max-width:42%;overflow:hidden;text-overflow:ellipsis;color:#6789ac;font-size:8px}.selectors{display:grid;gap:11px;padding:14px}.selectors label>span,.object-row label>span,.guard label>span{display:block;margin-bottom:5px;color:#7087a1;font-size:8px;text-transform:uppercase}select,input{width:100%;min-width:0;border:1px solid #263a52;border-radius:6px;padding:7px 8px;background:#0b1726;color:#dbe7f5;outline:none}.primary,.secondary,header button,.remove,.tabs button,.guard button{cursor:pointer}.primary{border:1px solid #4a86dd;border-radius:7px;padding:8px 10px;background:#3477d8;color:white;font-size:9px}.secondary{border:1px solid #304966;border-radius:6px;padding:7px 9px;background:#14263b;color:#bfd0e3;font-size:8px}.source-meta{display:grid;gap:4px;margin-top:auto;padding:11px 14px;border-top:1px solid #1b2c3f;color:#607892;font-size:8px}.empty{margin:auto;padding:28px;text-align:center;color:#71879f}.empty strong{display:block;color:#c5d5e5;font-size:10px}.empty p{margin:6px 0 0;font-size:8px}.object-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:end;padding:12px 14px;border-bottom:1px solid #1b2c3f}.object-row>div{display:flex;gap:5px;flex-wrap:wrap}.object-row>div span{border:1px solid #2b435c;border-radius:999px;padding:3px 6px;color:#718daa;font-size:7px}.attribute-toolbar{display:flex;justify-content:space-between;align-items:center;padding:9px 13px;color:#a8bad0;font-size:9px}.attribute-head,.attribute-row{display:grid;grid-template-columns:1fr 1fr 95px 1fr 135px 26px;gap:6px;align-items:center}.attribute-head{padding:6px 9px;background:#0d1b2c;color:#5f7690;font-size:7px;text-transform:uppercase}.attributes{flex:1;min-height:0;overflow:auto}.attribute-row{padding:5px 9px;border-bottom:1px solid #17283a}.attribute-row input,.attribute-row select{padding:5px 6px;font-size:8px}.flags{display:flex;gap:5px;align-items:center;flex-wrap:wrap;color:#7189a3;font-size:7px}.flags label{display:flex;gap:2px;align-items:center}.flags input{width:auto}.flags small{border:1px solid #294057;border-radius:4px;padding:2px 3px}.remove{border:0;background:transparent;color:#be7882;font-size:16px}.design-panel>footer{display:flex;gap:10px;align-items:center;padding:10px 13px;border-top:1px solid #1b2c3f}.design-panel>footer span{color:#5e758e;font-size:7px}.tabs{display:flex;gap:3px}.tabs button,header>button{border:1px solid #2b425a;border-radius:5px;padding:5px 7px;background:#101e30;color:#7790aa;font-size:7px}.tabs button.active{background:#1b344f;color:#c6d7e9}.risk{display:flex;justify-content:space-between;padding:8px 11px}.risk span{border:1px solid #2c5f49;border-radius:999px;padding:3px 7px;color:#83c9a7;font-size:7px}.risk span.destructive{border-color:#6b3a43;color:#e49aa4}.risk code{color:#56718e;font-size:7px}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#20354b}.summary div{padding:8px 10px;background:#0c1a29}.summary small,.summary strong{display:block}.summary small{color:#5d7691;font-size:7px;text-transform:uppercase}.summary strong{margin-top:2px;color:#bfd0e0;font-size:11px}.warnings{padding:7px 10px;background:#26171b}.warnings p{margin:3px 0;color:#db9ba4;font-size:7px}.diffs{max-height:130px;overflow:auto;padding:7px 10px;border-bottom:1px solid #1b2c3f}.diffs div{display:grid;grid-template-columns:130px 1fr;gap:6px;padding:4px 0;color:#8da2b9;font-size:7px}.diffs code{color:#7196bd}.result-panel pre{min-height:120px;max-height:220px;overflow:auto;margin:0;padding:11px;background:#07121f;color:#a9c2dc;font:8px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}.guard{display:grid;gap:7px;padding:10px;border-top:1px solid #263a4f;background:#0a1623}.guard code{display:block;margin-bottom:5px;color:#d7aa69;font-size:8px}.guard button{border:1px solid #356848;border-radius:6px;padding:7px;background:#153122;color:#91d4ad;font-size:8px}.guard button.dangerous{border-color:#6b3841;background:#311820;color:#eba0aa}.guard p{margin:0;color:#596f87;font-size:7px}.graph{display:grid;grid-template-columns:repeat(2,minmax(140px,1fr));gap:8px;overflow:auto;padding:10px}.graph article{border:1px solid #294159;border-radius:7px;padding:8px;background:#0d1d2e}.graph article.external{border-style:dashed;opacity:.75}.graph article strong,.graph article small{display:block}.graph article strong{color:#c3d4e5;font-size:8px}.graph article small{margin-top:2px;color:#5e7894;font-size:7px}.graph article p{margin:6px 0 0;color:#839ab2;font-size:7px}.graph article p small{display:inline;margin-left:4px}.activity{min-height:29px;display:flex;gap:7px;align-items:center;padding:6px 20px;border-top:1px solid #1a2a3e;background:#091422;color:#7489a2;font-size:8px}.activity>span{width:6px;height:6px;border-radius:50%;background:#4d83c9}.activity p{margin:0}.activity small{margin-left:auto}.activity.error{color:#de8995}@media(max-width:1300px){.designer-shell{grid-template-columns:260px 1fr}.result-panel{grid-column:1/-1;min-height:350px}}
</style>

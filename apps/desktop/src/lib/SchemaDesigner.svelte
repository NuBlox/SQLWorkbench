<script lang="ts">
  import { onMount } from "svelte";
  import type { ConnectionProfile } from "@nublox/workbench-connection-profiles";
  import type {
    ExplorerNamespace,
    ExplorerRelation,
    OpenConnectionInfo,
    SchemaAttributeDraft,
    SchemaDraftInput,
    SchemaDraftView,
    SchemaPreview,
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
  let preview: SchemaPreview | undefined;
  let busy = false;
  let errorMessage = "";
  let notice = "Select an open connection, database and table to begin schema engineering.";

  $: selectedNamespace = namespaces.find((item) => item.key === namespaceKey);
  $: selectedRelation = relations.find((item) => item.key === relationKey);
  $: selectedProfile = profiles.find((item) => item.id === connectionId);

  onMount(() => { void refreshConnections(); });

  async function refreshConnections(): Promise<void> {
    await runBusy(async () => {
      [profiles, connections] = await Promise.all([
        window.nublox.profiles.list(),
        window.nublox.connections.list(),
      ]);
      if (!connections.some((item) => item.profileId === connectionId)) {
        connectionId = connections[0]?.profileId ?? "";
      }
      await loadNamespaces();
    });
  }

  async function changeConnection(): Promise<void> {
    resetDesign();
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
    if (!connectionId || !selectedNamespace) return;
    relations = await window.nublox.explorer.relations({
      connectionId,
      ...(selectedNamespace.catalog ? { catalog: selectedNamespace.catalog } : {}),
      ...(selectedNamespace.schema ? { schema: selectedNamespace.schema } : {}),
    });
    const firstTable = relations.find((item) => item.kind === "table") ?? relations[0];
    relationKey = firstTable?.key ?? "";
  }

  async function loadDraft(): Promise<void> {
    if (!connectionId || !selectedRelation) return;
    await runBusy(async () => {
      draft = await window.nublox.schema.load(relationRequest());
      logicalName = draft.logicalName;
      attributes = draft.attributes.map(editableAttribute);
      preview = undefined;
      notice = `Reverse-engineered ${qualified(selectedRelation)} into ${draft.objectTypeId}.`;
    });
  }

  function addAttribute(): void {
    const next = uniqueAttributeName("newAttribute");
    attributes = [
      ...attributes,
      {
        name: next,
        physicalColumn: toSnakeCase(next),
        type: "string",
        databaseType: "varchar(255)",
        required: false,
        nullable: true,
        readOnly: false,
        unique: false,
      },
    ];
    preview = undefined;
  }

  function removeAttribute(index: number): void {
    attributes = attributes.filter((_attribute, offset) => offset !== index);
    preview = undefined;
  }

  function updateAttribute(index: number, field: keyof EditableAttribute, value: string | boolean): void {
    attributes = attributes.map((attribute, offset) => offset === index ? { ...attribute, [field]: value } : attribute);
    if (field === "nullable" && value === false) {
      attributes = attributes.map((attribute, offset) => offset === index ? { ...attribute, required: true } : attribute);
    }
    if (field === "required" && value === true) {
      attributes = attributes.map((attribute, offset) => offset === index ? { ...attribute, nullable: false } : attribute);
    }
    preview = undefined;
  }

  async function generatePreview(): Promise<void> {
    if (!draft || !selectedRelation) return;
    await runBusy(async () => {
      preview = await window.nublox.schema.preview({
        ...relationRequest(),
        draft: currentDraft(),
      });
      notice = preview.neutralPlan.operations.length === 0
        ? "Logical draft matches the live physical schema."
        : `Generated ${preview.neutralPlan.operations.length} schema change operation${preview.neutralPlan.operations.length === 1 ? "" : "s"}.`;
    });
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

  function editableAttribute(attribute: SchemaAttributeDraft): EditableAttribute {
    return {
      name: attribute.name,
      physicalColumn: attribute.physicalColumn,
      type: attribute.type,
      databaseType: attribute.databaseType ?? "",
      required: attribute.required,
      nullable: attribute.nullable,
      readOnly: attribute.readOnly,
      unique: attribute.unique,
    };
  }

  function resetDesign(): void {
    draft = undefined;
    logicalName = "";
    attributes = [];
    preview = undefined;
  }

  function uniqueAttributeName(base: string): string {
    const names = new Set(attributes.map((attribute) => attribute.name));
    if (!names.has(base)) return base;
    let suffix = 2;
    while (names.has(`${base}${suffix}`)) suffix += 1;
    return `${base}${suffix}`;
  }

  function toSnakeCase(value: string): string {
    return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();
  }

  function qualified(relation: ExplorerRelation): string {
    return [relation.catalog, relation.schema, relation.name].filter(Boolean).join(".");
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
  <div class="panel source-panel">
    <div class="panel-heading">
      <div><h2>Live schema source</h2><p>Reverse-engineer a connected database object into an editable metaobject draft.</p></div>
      <button class="quiet-button" type="button" onclick={refreshConnections} disabled={busy}>↻</button>
    </div>
    <div class="selectors">
      <label><span>Connection</span><select bind:value={connectionId} onchange={changeConnection}><option value="">Select connection</option>{#each connections as connection}<option value={connection.profileId}>{profiles.find((item) => item.id === connection.profileId)?.name ?? connection.profileId}</option>{/each}</select></label>
      <label><span>Database / schema</span><select bind:value={namespaceKey} onchange={loadRelations} disabled={!connectionId}><option value="">Select namespace</option>{#each namespaces as namespace}<option value={namespace.key}>{namespace.label}</option>{/each}</select></label>
      <label><span>Table / view</span><select bind:value={relationKey} onchange={resetDesign} disabled={!namespaceKey}><option value="">Select object</option>{#each relations as relation}<option value={relation.key}>{relation.name} · {relation.kind}</option>{/each}</select></label>
      <button class="primary" type="button" onclick={loadDraft} disabled={busy || !selectedRelation}>Reverse engineer</button>
    </div>
    {#if selectedProfile}<div class="source-meta"><span>{selectedProfile.host}:{selectedProfile.port ?? 3306}</span><span>{selectedRelation ? qualified(selectedRelation) : "No object selected"}</span></div>{/if}
  </div>

  <div class="panel design-panel">
    <div class="panel-heading">
      <div><h2>Logical schema draft</h2><p>Edit logical metadata while retaining the exact physical database mapping.</p></div>
      {#if draft}<span class="model-id">{draft.objectTypeId}</span>{/if}
    </div>

    {#if !draft}
      <div class="empty-state"><strong>No schema draft loaded</strong><p>Select a live table and reverse-engineer it to begin.</p></div>
    {:else}
      <div class="object-header">
        <label><span>Logical object name</span><input bind:value={logicalName} oninput={() => (preview = undefined)} /></label>
        <div class="badges"><span>{draft.kind}</span><span>PK: {draft.primaryKey.join(", ") || "none"}</span><span>{draft.relationships.length} relations</span></div>
      </div>
      <div class="attributes-toolbar"><strong>Attributes</strong><button class="secondary" type="button" onclick={addAttribute}>+ Add attribute</button></div>
      <div class="attribute-grid header"><span>Logical name</span><span>Physical column</span><span>Logical type</span><span>Database type</span><span>Flags</span><span></span></div>
      <div class="attribute-list">
        {#each attributes as attribute, index (`${attribute.name}:${index}`)}
          <div class="attribute-grid">
            <input value={attribute.name} oninput={(event) => updateAttribute(index, "name", event.currentTarget.value)} />
            <input value={attribute.physicalColumn} oninput={(event) => updateAttribute(index, "physicalColumn", event.currentTarget.value)} />
            <select value={attribute.type} onchange={(event) => updateAttribute(index, "type", event.currentTarget.value)}>{#each logicalTypes as type}<option value={type}>{type}</option>{/each}</select>
            <input value={attribute.databaseType} placeholder="provider default" oninput={(event) => updateAttribute(index, "databaseType", event.currentTarget.value)} />
            <div class="flags">
              <label title="Required"><input type="checkbox" checked={attribute.required} onchange={(event) => updateAttribute(index, "required", event.currentTarget.checked)} />req</label>
              <label title="Nullable"><input type="checkbox" checked={attribute.nullable} onchange={(event) => updateAttribute(index, "nullable", event.currentTarget.checked)} />null</label>
              <label title="Unique"><input type="checkbox" checked={attribute.unique} onchange={(event) => updateAttribute(index, "unique", event.currentTarget.checked)} />uniq</label>
              {#if attribute.readOnly}<span>read-only</span>{/if}
            </div>
            <button class="remove" type="button" title="Remove attribute" onclick={() => removeAttribute(index)}>×</button>
          </div>
        {/each}
      </div>
      <div class="design-actions"><button class="primary" type="button" disabled={busy || attributes.length === 0 || !logicalName.trim()} onclick={generatePreview}>Compare & preview migration</button><span>No schema changes are executed from this screen.</span></div>
    {/if}
  </div>

  <div class="panel preview-panel">
    <div class="panel-heading"><div><h2>Schema diff & DDL preview</h2><p>Regenerated from live metadata every time you preview.</p></div>{#if preview}<span class:destructive={preview.neutralPlan.destructive} class="risk-badge">{preview.neutralPlan.destructive ? "Destructive changes" : "Non-destructive"}</span>{/if}</div>
    {#if !preview}
      <div class="empty-state compact"><strong>No preview generated</strong><p>Edit the draft, then compare it with the live schema.</p></div>
    {:else}
      <div class="preview-summary"><div><span>Differences</span><strong>{preview.differences.length}</strong></div><div><span>Operations</span><strong>{preview.neutralPlan.operations.length}</strong></div><div><span>Provider</span><strong>{preview.providerPreview.providerId}</strong></div></div>
      {#if preview.providerPreview.warnings.length}<div class="warnings">{#each preview.providerPreview.warnings as warning}<p>{warning}</p>{/each}</div>{/if}
      <div class="diff-list">
        {#each preview.differences as difference}<div><strong>{difference.kind}</strong><code>{difference.path}</code></div>{/each}
        {#if preview.differences.length === 0}<p class="match">Live schema and logical draft match.</p>{/if}
      </div>
      <div class="ddl-heading"><strong>MySQL DDL preview</strong><span>preview only</span></div>
      <pre>{preview.providerPreview.statements.length ? preview.providerPreview.statements.join("\n\n") : "-- No schema changes required."}</pre>
    {/if}
  </div>
</section>

<footer class="activity-bar" class:error={Boolean(errorMessage)}><span class="activity-indicator"></span><span>{errorMessage || notice}</span>{#if busy}<span class="activity-busy">Working…</span>{/if}</footer>

<style>
  .designer-shell{flex:1;min-height:0;display:grid;grid-template-columns:300px minmax(520px,1.45fr) minmax(340px,.9fr);gap:14px;padding:18px 20px}.panel{min-width:0;min-height:0;overflow:hidden;border:1px solid #1e3044;border-radius:11px;background:rgba(13,25,41,.86)}.source-panel,.design-panel,.preview-panel{display:flex;flex-direction:column}.panel-heading{display:flex;justify-content:space-between;gap:14px;align-items:center;padding:15px 16px;border-bottom:1px solid #1b2c3f}.panel-heading h2{margin:0 0 3px;color:#edf5fd;font-size:13px}.panel-heading p{margin:0;color:#71869e;font-size:9px;line-height:1.4}.selectors{display:grid;gap:11px;padding:15px}.selectors label>span,.object-header label>span{display:block;margin-bottom:5px;color:#7087a1;font-size:8px;text-transform:uppercase}.selectors select,.object-header input,.attribute-grid input,.attribute-grid select{width:100%;min-width:0;border:1px solid #263a52;border-radius:6px;padding:7px 8px;background:#0b1726;color:#dbe7f5;outline:none}.primary,.secondary,.quiet-button,.remove{cursor:pointer}.primary{border:1px solid #4a86dd;border-radius:7px;padding:8px 11px;background:#3477d8;color:#fff;font-size:9px;font-weight:650}.secondary{border:1px solid #304966;border-radius:6px;padding:6px 9px;background:#14263b;color:#bfd0e3;font-size:8px}.quiet-button{border:1px solid #2b425d;border-radius:6px;padding:5px 9px;background:transparent;color:#839ab5}.source-meta{display:grid;gap:5px;margin-top:auto;padding:12px 15px;border-top:1px solid #1b2c3f;color:#607892;font-size:8px}.model-id{max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6993c5;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:8px}.empty-state{margin:auto;padding:30px;text-align:center;color:#70869f}.empty-state strong{display:block;color:#c5d5e6;font-size:11px}.empty-state p{margin:6px 0 0;font-size:9px}.empty-state.compact{margin:0}.object-header{display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:15px;align-items:end;padding:13px 15px;border-bottom:1px solid #1b2c3f}.badges{display:flex;gap:5px;flex-wrap:wrap}.badges span,.risk-badge{border:1px solid #29435e;border-radius:999px;padding:4px 7px;color:#7895b5;font-size:7px}.risk-badge.destructive{border-color:#693842;color:#e797a3;background:#2a151d}.attributes-toolbar{display:flex;justify-content:space-between;align-items:center;padding:10px 15px;color:#9fb3ca;font-size:9px}.attribute-list{flex:1;min-height:0;overflow:auto}.attribute-grid{display:grid;grid-template-columns:1fr 1fr 105px 1fr 150px 28px;gap:7px;align-items:center;padding:6px 10px;border-bottom:1px solid #17283a}.attribute-grid.header{padding-top:7px;padding-bottom:7px;background:#0d1b2c;color:#607a97;font-size:7px;text-transform:uppercase}.attribute-grid input,.attribute-grid select{padding:6px;font-size:8px}.flags{display:flex;gap:6px;align-items:center;flex-wrap:wrap;color:#7189a4;font-size:7px}.flags label{display:flex;gap:2px;align-items:center}.flags input{width:auto}.flags span{border:1px solid #2c435c;border-radius:4px;padding:2px 4px}.remove{border:0;background:transparent;color:#b56d78;font-size:17px}.design-actions{display:flex;gap:10px;align-items:center;padding:11px 15px;border-top:1px solid #1b2c3f}.design-actions span{color:#607891;font-size:8px}.preview-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#1d3248;border-bottom:1px solid #1d3248}.preview-summary div{padding:10px;background:#0c1a2a}.preview-summary span,.preview-summary strong{display:block}.preview-summary span{color:#607a96;font-size:7px;text-transform:uppercase}.preview-summary strong{margin-top:3px;color:#bfd0e2;font-size:12px}.warnings{padding:8px 12px;border-bottom:1px solid #4a3036;background:#25171b}.warnings p{margin:3px 0;color:#d99aa3;font-size:8px}.diff-list{max-height:180px;overflow:auto;padding:8px 12px;border-bottom:1px solid #1b2c3f}.diff-list div{display:grid;grid-template-columns:140px 1fr;gap:8px;padding:5px 0;color:#91a5bd;font-size:8px}.diff-list strong{font-weight:600}.diff-list code{color:#7095bf}.match{color:#7fc7aa;font-size:9px}.ddl-heading{display:flex;justify-content:space-between;padding:10px 12px;color:#9eb2c8;font-size:8px}.ddl-heading span{color:#5c7490;text-transform:uppercase}.preview-panel pre{flex:1;min-height:160px;overflow:auto;margin:0;padding:13px;background:#07121f;color:#a9c2dc;font:9px/1.55 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;white-space:pre-wrap}.activity-bar{min-height:29px;display:flex;gap:8px;align-items:center;padding:6px 22px;border-top:1px solid #1a2a3e;background:#091422;color:#7489a2;font-size:9px}.activity-bar.error{color:#de8995}.activity-indicator{width:6px;height:6px;border-radius:50%;background:#4d83c9}.activity-busy{margin-left:auto}@media(max-width:1350px){.designer-shell{grid-template-columns:270px minmax(500px,1fr);}.preview-panel{grid-column:1/-1;min-height:340px}.attribute-grid{grid-template-columns:1fr 1fr 95px 1fr 130px 28px}}
</style>

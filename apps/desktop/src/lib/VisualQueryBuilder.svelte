<script lang="ts">
  import {
    renderVisualQuery,
    visualQueryRelations,
    visualSourceFromRelation,
    type VisualQueryAggregate,
    type VisualQueryFilterOperator,
    type VisualQueryJoinType,
    type VisualQueryModel,
    type VisualQueryOrderDirection,
    type VisualQueryRelationOption,
  } from "@nublox/workbench-query-engineering/visual-query";
  import type { QueryCompletionCatalog } from "$lib/desktop-api";

  export let catalog: QueryCompletionCatalog | undefined = undefined;
  export let onApply: (sql: string) => void = () => undefined;

  interface ProjectionDraft { id: string; sourceId: string; column: string; aggregate: VisualQueryAggregate; alias: string; }
  interface JoinDraft { id: string; relationKey: string; alias: string; type: VisualQueryJoinType; leftSourceId: string; leftColumn: string; rightColumn: string; }
  interface FilterDraft { id: string; conjunction: "and" | "or"; sourceId: string; column: string; operator: VisualQueryFilterOperator; valueKind: "text" | "number" | "boolean"; value: string; }
  interface GroupDraft { id: string; sourceId: string; column: string; }
  interface OrderDraft { id: string; sourceId: string; column: string; direction: VisualQueryOrderDirection; }
  interface SourceOption { id: string; label: string; relation: VisualQueryRelationOption; }

  let catalogVersion = "";
  let sequence = 0;
  let baseKey = "";
  let baseAlias = "t1";
  let distinct = false;
  let limitText = "100";
  let projections: ProjectionDraft[] = [];
  let joins: JoinDraft[] = [];
  let filters: FilterDraft[] = [];
  let groups: GroupDraft[] = [];
  let orders: OrderDraft[] = [];
  let relations: readonly VisualQueryRelationOption[] = [];
  let sourceOptions: SourceOption[] = [];
  let preview: { sql: string; error: string } = { sql: "", error: "" };

  $: relations = visualQueryRelations(catalog);
  $: if ((catalog?.capturedAt ?? "") !== catalogVersion) {
    catalogVersion = catalog?.capturedAt ?? "";
    reset();
  }
  $: {
    baseKey;
    baseAlias;
    joins;
    relations;
    sourceOptions = buildSourceOptions();
  }
  $: {
    catalog;
    relations;
    baseKey;
    baseAlias;
    distinct;
    limitText;
    projections;
    joins;
    filters;
    groups;
    orders;
    sourceOptions;
    preview = buildPreview();
  }

  function reset(): void {
    const available = visualQueryRelations(catalog);
    sequence = 0;
    baseKey = available[0]?.key ?? "";
    baseAlias = "t1";
    distinct = false;
    limitText = "100";
    projections = [];
    joins = [];
    filters = [];
    groups = [];
    orders = [];
  }

  function nextId(prefix: string): string {
    sequence += 1;
    return `${prefix}-${sequence}`;
  }

  function relation(key: string): VisualQueryRelationOption | undefined {
    return relations.find((item) => item.key === key);
  }

  function buildSourceOptions(): SourceOption[] {
    const result: SourceOption[] = [];
    const base = relation(baseKey);
    if (base) result.push({ id: "base", label: baseAlias.trim() || base.name, relation: base });
    for (const join of joins) {
      const item = relation(join.relationKey);
      if (item) result.push({ id: join.id, label: join.alias.trim() || item.name, relation: item });
    }
    return result;
  }

  function columnsFor(sourceId: string): readonly string[] {
    return sourceOptions.find((source) => source.id === sourceId)?.relation.columns ?? [];
  }

  function addProjection(): void {
    const source = sourceOptions[0];
    if (!source) return;
    projections = [...projections, { id: nextId("projection"), sourceId: source.id, column: source.relation.columns[0] ?? "*", aggregate: "none", alias: "" }];
  }

  function addJoin(): void {
    const joined = relations.find((item) => item.key !== baseKey) ?? relations[0];
    const left = sourceOptions[0];
    if (!joined || !left) return;
    const id = nextId("join");
    joins = [...joins, {
      id,
      relationKey: joined.key,
      alias: `t${joins.length + 2}`,
      type: "inner",
      leftSourceId: left.id,
      leftColumn: left.relation.columns[0] ?? "",
      rightColumn: joined.columns[0] ?? "",
    }];
  }

  function addFilter(): void {
    const source = sourceOptions[0];
    if (!source) return;
    filters = [...filters, { id: nextId("filter"), conjunction: "and", sourceId: source.id, column: source.relation.columns[0] ?? "", operator: "=", valueKind: "text", value: "" }];
  }

  function addGroup(): void {
    const source = sourceOptions[0];
    if (!source) return;
    groups = [...groups, { id: nextId("group"), sourceId: source.id, column: source.relation.columns[0] ?? "" }];
  }

  function addOrder(): void {
    const source = sourceOptions[0];
    if (!source) return;
    orders = [...orders, { id: nextId("order"), sourceId: source.id, column: source.relation.columns[0] ?? "", direction: "asc" }];
  }

  function removeProjection(id: string): void { projections = projections.filter((item) => item.id !== id); }
  function removeJoin(id: string): void {
    joins = joins.filter((item) => item.id !== id);
    projections = projections.filter((item) => item.sourceId !== id);
    filters = filters.filter((item) => item.sourceId !== id);
    groups = groups.filter((item) => item.sourceId !== id);
    orders = orders.filter((item) => item.sourceId !== id);
  }
  function removeFilter(id: string): void { filters = filters.filter((item) => item.id !== id); }
  function removeGroup(id: string): void { groups = groups.filter((item) => item.id !== id); }
  function removeOrder(id: string): void { orders = orders.filter((item) => item.id !== id); }

  function buildModel(): VisualQueryModel {
    const base = relation(baseKey);
    const from = base ? visualSourceFromRelation("base", base, baseAlias) : undefined;
    const modelJoins = joins.flatMap((draft) => {
      const item = relation(draft.relationKey);
      if (!item) return [];
      const source = visualSourceFromRelation(draft.id, item, draft.alias);
      return [{
        id: draft.id,
        type: draft.type,
        source,
        ...(draft.type !== "cross" ? {
          left: { sourceId: draft.leftSourceId, column: draft.leftColumn },
          right: { sourceId: draft.id, column: draft.rightColumn },
        } : {}),
      }];
    });
    return {
      distinct,
      ...(from ? { from } : {}),
      projections: projections.map((item) => ({
        id: item.id,
        sourceId: item.sourceId,
        column: item.column,
        aggregate: item.aggregate,
        ...(item.alias.trim() ? { alias: item.alias.trim() } : {}),
      })),
      joins: modelJoins,
      filters: filters.map((item) => ({
        id: item.id,
        conjunction: item.conjunction,
        sourceId: item.sourceId,
        column: item.column,
        operator: item.operator,
        ...((item.operator !== "is-null" && item.operator !== "is-not-null") ? { value: filterValue(item) } : {}),
      })),
      groupBy: groups.map((item) => ({ id: item.id, sourceId: item.sourceId, column: item.column })),
      orderBy: orders.map((item) => ({ id: item.id, sourceId: item.sourceId, column: item.column, direction: item.direction })),
      ...(limitText.trim() ? { limit: Number(limitText) } : {}),
    };
  }

  function filterValue(filter: FilterDraft) {
    if (filter.valueKind === "number") {
      const value = filter.value.trim();
      return { kind: "number" as const, value: value ? Number(value) : Number.NaN };
    }
    if (filter.valueKind === "boolean") return { kind: "boolean" as const, value: filter.value === "true" };
    return { kind: "text" as const, value: filter.value };
  }

  function buildPreview(): { sql: string; error: string } {
    if (!catalog || relations.length === 0 || !baseKey) return { sql: "", error: "Load live IntelliSense metadata to build a query." };
    try { return { sql: renderVisualQuery(buildModel(), catalog), error: "" }; }
    catch (error) { return { sql: "", error: error instanceof Error ? error.message : String(error) }; }
  }

  function apply(): void {
    if (preview.sql) onApply(preview.sql);
  }
</script>

<section class="builder" aria-label="Visual query builder">
  <div class="configuration">
    <header class="builder-header">
      <div><span class="eyebrow">Visual query builder</span><strong>Build SELECT without hand-writing SQL</strong></div>
      <div class="header-actions"><button type="button" class="ghost" onclick={reset}>Reset</button><button type="button" class="apply" disabled={!preview.sql} onclick={apply}>Apply to editor</button></div>
    </header>

    {#if relations.length === 0}
      <div class="empty">No live table/view metadata is loaded for this connection.</div>
    {:else}
      <div class="source-card">
        <label><span>FROM</span><select bind:value={baseKey}>{#each relations as item (item.key)}<option value={item.key}>{item.namespaceLabel}.{item.name} · {item.kind}</option>{/each}</select></label>
        <label class="alias"><span>Alias</span><input bind:value={baseAlias} placeholder="t1" /></label>
        <label class="check"><input type="checkbox" bind:checked={distinct} /><span>DISTINCT</span></label>
        <label class="limit"><span>Limit</span><input inputmode="numeric" bind:value={limitText} placeholder="100" /></label>
      </div>

      <div class="section">
        <div class="section-heading"><div><strong>Columns</strong><small>Projection and aggregates</small></div><button type="button" onclick={addProjection}>+ Column</button></div>
        {#if projections.length === 0}<p class="hint">No columns selected — SQL will use <code>*</code>.</p>{/if}
        {#each projections as item (item.id)}
          <div class="row projection-row">
            <select bind:value={item.sourceId}>{#each sourceOptions as source (source.id)}<option value={source.id}>{source.label}</option>{/each}</select>
            <select bind:value={item.column}>{#each columnsFor(item.sourceId) as column}<option value={column}>{column}</option>{/each}</select>
            <select bind:value={item.aggregate}><option value="none">No aggregate</option><option value="count">COUNT</option><option value="sum">SUM</option><option value="avg">AVG</option><option value="min">MIN</option><option value="max">MAX</option></select>
            <input bind:value={item.alias} placeholder="Output alias" />
            <button class="remove" type="button" aria-label="Remove column" onclick={() => removeProjection(item.id)}>×</button>
          </div>
        {/each}
      </div>

      <div class="section">
        <div class="section-heading"><div><strong>Joins</strong><small>Relate live catalogue objects</small></div><button type="button" onclick={addJoin}>+ Join</button></div>
        {#if joins.length === 0}<p class="hint">No joins.</p>{/if}
        {#each joins as item (item.id)}
          <div class="join-card">
            <div class="row join-source">
              <select bind:value={item.type}><option value="inner">INNER</option><option value="left">LEFT</option><option value="right">RIGHT</option><option value="cross">CROSS</option></select>
              <select bind:value={item.relationKey}>{#each relations as relationItem (relationItem.key)}<option value={relationItem.key}>{relationItem.namespaceLabel}.{relationItem.name}</option>{/each}</select>
              <input bind:value={item.alias} placeholder="Alias" />
              <button class="remove" type="button" aria-label="Remove join" onclick={() => removeJoin(item.id)}>×</button>
            </div>
            {#if item.type !== "cross"}
              <div class="row join-condition">
                <span>ON</span>
                <select bind:value={item.leftSourceId}>{#each sourceOptions.filter((source) => source.id !== item.id) as source (source.id)}<option value={source.id}>{source.label}</option>{/each}</select>
                <select bind:value={item.leftColumn}>{#each columnsFor(item.leftSourceId) as column}<option value={column}>{column}</option>{/each}</select>
                <span>=</span>
                <strong>{item.alias || relation(item.relationKey)?.name || "joined"}</strong>
                <select bind:value={item.rightColumn}>{#each relation(item.relationKey)?.columns ?? [] as column}<option value={column}>{column}</option>{/each}</select>
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <div class="section">
        <div class="section-heading"><div><strong>Filters</strong><small>WHERE predicates</small></div><button type="button" onclick={addFilter}>+ Filter</button></div>
        {#if filters.length === 0}<p class="hint">No filters.</p>{/if}
        {#each filters as item, index (item.id)}
          <div class="row filter-row">
            {#if index === 0}<span class="fixed">WHERE</span>{:else}<select bind:value={item.conjunction}><option value="and">AND</option><option value="or">OR</option></select>{/if}
            <select bind:value={item.sourceId}>{#each sourceOptions as source (source.id)}<option value={source.id}>{source.label}</option>{/each}</select>
            <select bind:value={item.column}>{#each columnsFor(item.sourceId) as column}<option value={column}>{column}</option>{/each}</select>
            <select bind:value={item.operator}><option value="=">=</option><option value="!=">!=</option><option value="<">&lt;</option><option value="<=">&lt;=</option><option value=">">&gt;</option><option value=">=">&gt;=</option><option value="like">LIKE</option><option value="not-like">NOT LIKE</option><option value="is-null">IS NULL</option><option value="is-not-null">IS NOT NULL</option></select>
            {#if item.operator !== "is-null" && item.operator !== "is-not-null"}
              <select bind:value={item.valueKind}><option value="text">Text</option><option value="number">Number</option><option value="boolean">Boolean</option></select>
              {#if item.valueKind === "boolean"}<select bind:value={item.value}><option value="true">TRUE</option><option value="false">FALSE</option></select>{:else}<input bind:value={item.value} placeholder="Value" />{/if}
            {/if}
            <button class="remove" type="button" aria-label="Remove filter" onclick={() => removeFilter(item.id)}>×</button>
          </div>
        {/each}
      </div>

      <div class="two-sections">
        <div class="section compact">
          <div class="section-heading"><div><strong>Group by</strong></div><button type="button" onclick={addGroup}>+ Group</button></div>
          {#each groups as item (item.id)}<div class="row compact-row"><select bind:value={item.sourceId}>{#each sourceOptions as source (source.id)}<option value={source.id}>{source.label}</option>{/each}</select><select bind:value={item.column}>{#each columnsFor(item.sourceId) as column}<option value={column}>{column}</option>{/each}</select><button class="remove" type="button" aria-label="Remove group" onclick={() => removeGroup(item.id)}>×</button></div>{/each}
        </div>
        <div class="section compact">
          <div class="section-heading"><div><strong>Order by</strong></div><button type="button" onclick={addOrder}>+ Order</button></div>
          {#each orders as item (item.id)}<div class="row compact-row"><select bind:value={item.sourceId}>{#each sourceOptions as source (source.id)}<option value={source.id}>{source.label}</option>{/each}</select><select bind:value={item.column}>{#each columnsFor(item.sourceId) as column}<option value={column}>{column}</option>{/each}</select><select bind:value={item.direction}><option value="asc">ASC</option><option value="desc">DESC</option></select><button class="remove" type="button" aria-label="Remove order" onclick={() => removeOrder(item.id)}>×</button></div>{/each}
        </div>
      </div>
    {/if}
  </div>

  <aside class="preview">
    <header><span class="eyebrow">Generated SQL</span><strong>Live preview</strong></header>
    {#if preview.error}<div class="validation">{preview.error}</div>{/if}
    {#if preview.sql}<pre>{preview.sql}</pre>{:else if !preview.error}<div class="empty">Choose a source to begin.</div>{/if}
    <div class="source-summary">
      <span>{sourceOptions.length} source{sourceOptions.length === 1 ? "" : "s"}</span>
      <span>{projections.length || "*"} projection{projections.length === 1 ? "" : "s"}</span>
      <span>{filters.length} filter{filters.length === 1 ? "" : "s"}</span>
    </div>
  </aside>
</section>

<style>
  .builder{height:100%;min-height:300px;display:grid;grid-template-columns:minmax(520px,1.45fr) minmax(300px,.8fr);background:#0a1421;color:#cfdae6}.configuration{overflow:auto;padding:12px}.preview{min-width:0;display:grid;grid-template-rows:auto auto 1fr auto;border-left:1px solid #223247;background:#0d1826}.builder-header,.preview header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 2px 12px}.builder-header>div:first-child,.preview header{align-items:flex-start}.builder-header>div:first-child{display:grid;gap:3px}.preview header{display:grid;justify-content:start;padding:14px;border-bottom:1px solid #223247}.eyebrow{color:#70879e;font-size:8px;letter-spacing:.09em;text-transform:uppercase}.builder-header strong,.preview strong{color:#e5edf6;font-size:11px}.header-actions{display:flex;gap:6px}.apply,.ghost,.section-heading button,.remove{border-radius:6px;cursor:pointer;font-size:9px}.apply{border:1px solid #4a86dd;background:#3477d8;color:white;padding:7px 10px}.ghost,.section-heading button{border:1px solid #2b425b;background:#112238;color:#91a9c2;padding:6px 8px}.apply:disabled{cursor:not-allowed;opacity:.45}.source-card{display:grid;grid-template-columns:minmax(220px,1fr) 110px auto 74px;gap:8px;align-items:end;padding:10px;border:1px solid #22364c;border-radius:8px;background:#0e1d2e}.source-card label{display:grid;gap:4px}.source-card label>span{color:#6f849b;font-size:8px;text-transform:uppercase}.source-card .check{display:flex;align-items:center;gap:6px;padding:8px 2px}.source-card .check span{font-size:9px}.section{margin-top:10px;border:1px solid #1d3044;border-radius:8px;background:#0c1928}.section-heading{display:flex;align-items:center;justify-content:space-between;padding:8px 9px;border-bottom:1px solid #1b2b3c}.section-heading>div{display:grid;gap:2px}.section-heading strong{font-size:10px}.section-heading small{color:#657b92;font-size:8px}.row{display:grid;gap:6px;align-items:center;padding:7px 8px;border-bottom:1px solid #142638}.projection-row{grid-template-columns:110px minmax(120px,1fr) 110px minmax(100px,.8fr) 24px}.join-card{border-bottom:1px solid #1a2a3d}.join-source{grid-template-columns:90px minmax(190px,1fr) 90px 24px;border-bottom:0}.join-condition{grid-template-columns:24px 90px minmax(100px,1fr) 18px 90px minmax(100px,1fr);padding-top:0;color:#6f849b;font-size:9px}.join-condition strong{overflow:hidden;text-overflow:ellipsis;color:#9db2c8;font-size:9px}.filter-row{grid-template-columns:54px 85px minmax(100px,1fr) 86px 75px minmax(80px,1fr) 24px}.fixed{color:#71879d;font-size:8px;text-align:center}.two-sections{display:grid;grid-template-columns:1fr 1fr;gap:10px}.compact-row{grid-template-columns:90px minmax(90px,1fr) auto 24px}.compact:first-child .compact-row{grid-template-columns:90px minmax(90px,1fr) 24px}.hint{margin:0;padding:10px;color:#61778e;font-size:9px}.hint code{color:#9eb5cb}.remove{width:24px;height:24px;border:0;background:transparent;color:#71879d;font-size:14px}.remove:hover{background:#2a1820;color:#dc8290}select,input{min-width:0;width:100%;box-sizing:border-box;border:1px solid #263b52;border-radius:5px;padding:6px 7px;background:#091625;color:#c6d5e4;font-size:9px}input[type="checkbox"]{width:auto}.preview pre{min-height:0;margin:0;overflow:auto;padding:14px;color:#bcd2e7;font:10px/1.6 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;white-space:pre-wrap}.validation{margin:10px 12px 0;border:1px solid #673641;border-radius:6px;padding:8px;background:#24151b;color:#dc8d99;font-size:9px;line-height:1.45}.empty{padding:28px;color:#657b92;font-size:9px;text-align:center}.source-summary{display:flex;gap:6px;flex-wrap:wrap;padding:9px 12px;border-top:1px solid #223247}.source-summary span{border-radius:999px;background:#14263a;padding:3px 6px;color:#758ca4;font-size:8px}@media(max-width:1150px){.builder{grid-template-columns:1fr}.preview{min-height:240px;border-left:0;border-top:1px solid #223247}.source-card{grid-template-columns:1fr 100px auto 70px}.filter-row{grid-template-columns:50px 80px minmax(90px,1fr) 80px 70px minmax(80px,1fr) 24px}}
</style>

<script lang="ts">
  import type { QueryPlanAnalysisView, QueryPlanNode } from "$lib/desktop-api";

  export let plan: QueryPlanAnalysisView;

  interface PlanRow {
    readonly node: QueryPlanNode;
    readonly depth: number;
  }

  let selectedId = "";
  $: rows = flatten(plan.root);
  $: if (!selectedId || !rows.some((row) => row.node.id === selectedId)) selectedId = plan.root.id;
  $: selected = rows.find((row) => row.node.id === selectedId)?.node ?? plan.root;

  function flatten(root: QueryPlanNode): PlanRow[] {
    const result: PlanRow[] = [];
    const visit = (node: QueryPlanNode, depth: number): void => {
      result.push({ node, depth });
      for (const child of node.children) visit(child, depth + 1);
    };
    visit(root, 0);
    return result;
  }

  function kindLabel(kind: string): string { return kind.replaceAll("-", " "); }
  function number(value: number): string { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value); }
  function milliseconds(value: number): string { return `${number(value)} ms`; }
  function signed(value: number): string { return `${value > 0 ? "+" : ""}${number(value)}`; }
</script>

<section class="plan-viewer" aria-label="Query execution plan">
  <header class="summary">
    <div>
      <span class="eyebrow">Optimizer plan · captured {new Date(plan.capturedAt).toLocaleString()}</span>
      <strong>{plan.providerId.toUpperCase()} · {plan.format}</strong>
    </div>
    <div class="summary-metrics">
      <span><b>{plan.nodeCount}</b> nodes</span>
      {#if plan.queryCost !== undefined}<span><b>{number(plan.queryCost)}</b> query cost</span>{/if}
      <span><b>{milliseconds(plan.explainElapsedMs)}</b> explain</span>
      <span><b>{plan.statistics.executionCount}</b> executions</span>
      {#if plan.statistics.averageElapsedMs !== undefined}<span><b>{milliseconds(plan.statistics.averageElapsedMs)}</b> avg runtime</span>{/if}
      <span><b>{plan.statistics.explainCount}</b> plan snapshots</span>
      {#if plan.statistics.planCostDelta !== undefined}<span class:regression={plan.statistics.planCostDelta > 0} class:improvement={plan.statistics.planCostDelta < 0}><b>{signed(plan.statistics.planCostDelta)}</b> cost Δ</span>{/if}
    </div>
  </header>

  <div class="plan-layout">
    <div class="tree" role="tree" aria-label="Execution plan operators">
      {#each rows as row (row.node.id)}
        <button type="button" class:active={selectedId === row.node.id} class="node-row" style={`padding-left:${12 + row.depth * 26}px`} onclick={() => selectedId = row.node.id} role="treeitem" aria-level={row.depth + 1} aria-selected={selectedId === row.node.id}>
          <span class="branch" aria-hidden="true"></span>
          <span class="kind">{kindLabel(row.node.kind)}</span>
          <span class="identity"><strong>{row.node.label}</strong>{#if row.node.subtitle}<small>{row.node.subtitle}</small>{/if}</span>
          <span class="inline-metrics">{#if row.node.estimatedRows !== undefined}<span>{number(row.node.estimatedRows)} rows</span>{/if}{#if row.node.estimatedCost !== undefined}<span>cost {number(row.node.estimatedCost)}</span>{/if}</span>
        </button>
      {/each}
    </div>

    <aside class="details" aria-label="Selected plan operator details">
      <div class="detail-heading"><span class="kind">{kindLabel(selected.kind)}</span><h3>{selected.label}</h3>{#if selected.subtitle}<p>{selected.subtitle}</p>{/if}</div>

      <div class="statistics-card">
        <h4>Query statistics</h4>
        <dl>
          <div><dt>Executions</dt><dd>{plan.statistics.executionCount}</dd></div>
          <div><dt>Successful</dt><dd>{plan.statistics.successCount}</dd></div>
          {#if plan.statistics.errorCount > 0}<div><dt>Errors</dt><dd>{plan.statistics.errorCount}</dd></div>{/if}
          {#if plan.statistics.cancelledCount > 0}<div><dt>Cancelled</dt><dd>{plan.statistics.cancelledCount}</dd></div>{/if}
          {#if plan.statistics.minimumElapsedMs !== undefined}<div><dt>Runtime range</dt><dd>{milliseconds(plan.statistics.minimumElapsedMs)} – {milliseconds(plan.statistics.maximumElapsedMs ?? plan.statistics.minimumElapsedMs)}</dd></div>{/if}
          <div><dt>Plan snapshots</dt><dd>{plan.statistics.explainCount}</dd></div>
          {#if plan.statistics.previousPlanCost !== undefined}<div><dt>Previous cost</dt><dd>{number(plan.statistics.previousPlanCost)}</dd></div>{/if}
          {#if plan.statistics.planCostDelta !== undefined}<div><dt>Cost change</dt><dd class:regression-text={plan.statistics.planCostDelta > 0} class:improvement-text={plan.statistics.planCostDelta < 0}>{signed(plan.statistics.planCostDelta)}</dd></div>{/if}
        </dl>
      </div>

      <dl class="primary-details">
        {#if selected.accessType}<div><dt>Access</dt><dd>{selected.accessType}</dd></div>{/if}
        {#if selected.keyUsed}<div><dt>Index / key</dt><dd>{selected.keyUsed}</dd></div>{/if}
        {#if selected.estimatedRows !== undefined}<div><dt>Estimated rows</dt><dd>{number(selected.estimatedRows)}</dd></div>{/if}
        {#if selected.filteredPercent !== undefined}<div><dt>Filtered</dt><dd>{number(selected.filteredPercent)}%</dd></div>{/if}
        {#if selected.estimatedCost !== undefined}<div><dt>Estimated cost</dt><dd>{number(selected.estimatedCost)}</dd></div>{/if}
      </dl>

      {#if selected.properties.length > 0}
        <div class="property-list"><h4>Optimizer properties</h4><dl>{#each selected.properties as property (property.key)}<div><dt>{property.label}</dt><dd>{property.value}</dd></div>{/each}</dl></div>
      {:else}<p class="empty-detail">No additional optimizer properties for this node.</p>{/if}
    </aside>
  </div>
</section>

<style>
  .plan-viewer{height:100%;min-height:260px;display:grid;grid-template-rows:auto 1fr;background:#0a1421;color:#d7e1eb}.summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 14px;border-bottom:1px solid #223247;background:#0f1b2a}.summary>div:first-child{display:grid;gap:2px}.summary strong{font-size:12px;font-weight:650}.eyebrow{color:#7890a7;font-size:9px;letter-spacing:.08em;text-transform:uppercase}.summary-metrics{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.summary-metrics span{border:1px solid #2a3d53;border-radius:999px;padding:4px 8px;color:#9fb1c4;font-size:10px}.summary-metrics b{color:#e3edf6;font-weight:650}.summary-metrics .regression{border-color:#67414a;color:#db9aa3}.summary-metrics .improvement{border-color:#315747;color:#8ac6a5}.plan-layout{min-height:0;display:grid;grid-template-columns:minmax(420px,1.6fr) minmax(250px,.8fr)}.tree{min-width:0;overflow:auto;padding:8px 0 16px;border-right:1px solid #223247}.node-row{position:relative;width:100%;min-height:48px;display:grid;grid-template-columns:86px minmax(140px,1fr) auto;align-items:center;gap:10px;padding-top:6px;padding-right:12px;padding-bottom:6px;border:0;border-bottom:1px solid #15263a;background:transparent;color:inherit;text-align:left;cursor:pointer}.node-row:hover{background:#101f30}.node-row.active{background:#14283d;box-shadow:inset 2px 0 #6ea8dc}.branch{position:absolute;left:8px;width:10px;border-top:1px solid #30475e}.kind{width:max-content;max-width:100%;border:1px solid #36516d;border-radius:4px;padding:2px 5px;color:#9dc3e7;font-size:9px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}.identity{min-width:0;display:grid;gap:2px}.identity strong{overflow:hidden;text-overflow:ellipsis;font-size:11px;white-space:nowrap}.identity small{overflow:hidden;color:#7890a7;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.inline-metrics{display:flex;gap:5px;justify-content:flex-end;flex-wrap:wrap}.inline-metrics span{border-radius:3px;background:#172a3e;padding:3px 5px;color:#a9bacb;font-size:9px;white-space:nowrap}.details{min-width:0;overflow:auto;padding:14px;background:#0d1826}.detail-heading{display:grid;gap:6px;padding-bottom:12px;border-bottom:1px solid #223247}.detail-heading h3{margin:0;color:#edf4fa;font-size:15px}.detail-heading p{margin:0;color:#8fa4b8;font-size:10px}.primary-details,.property-list dl,.statistics-card dl{margin:12px 0 0;display:grid;gap:1px}.primary-details div,.property-list dl div,.statistics-card dl div{display:grid;grid-template-columns:minmax(100px,.8fr) minmax(100px,1fr);gap:10px;padding:7px 8px;background:#101f30}dt{color:#778da3;font-size:9px;text-transform:uppercase;letter-spacing:.04em}dd{margin:0;overflow-wrap:anywhere;color:#cbd9e6;font-size:10px;text-align:right}.statistics-card{margin-top:14px;padding-bottom:12px;border-bottom:1px solid #223247}.statistics-card h4,.property-list h4{margin:0;color:#9fb1c4;font-size:10px;text-transform:uppercase;letter-spacing:.06em}.regression-text{color:#e8a0aa}.improvement-text{color:#91d0ac}.property-list{margin-top:16px}.empty-detail{margin-top:16px;color:#687f95;font-size:10px}@media(max-width:1100px){.plan-layout{grid-template-columns:1fr}.tree{border-right:0;border-bottom:1px solid #223247;max-height:330px}.details{max-height:300px}}
</style>

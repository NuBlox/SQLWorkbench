<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { ConnectionProfile } from "@nublox/workbench-connection-profiles";
  import QueryPlanViewer from "$lib/QueryPlanViewer.svelte";
  import SqlEditor from "$lib/SqlEditor.svelte";
  import VisualQueryBuilder from "$lib/VisualQueryBuilder.svelte";
  import type {
    ExportFormat,
    OpenConnectionInfo,
    QueryCompletionCatalog,
    QueryExecutionView,
    QueryHistoryEntry,
    QueryPlanView,
    QueryRunMode,
  } from "$lib/desktop-api";

  let profiles: readonly ConnectionProfile[] = [];
  let openConnections: readonly OpenConnectionInfo[] = [];
  let queryHistory: readonly QueryHistoryEntry[] = [];
  let activeConnectionId = "";
  let sqlText = "SELECT VERSION() AS version;\n";
  let sqlEditor: SqlEditor;
  let currentExecution: QueryExecutionView | undefined;
  let explainPlan: QueryPlanView | undefined;
  let outputMode: "results" | "plan" | "builder" = "results";
  let activeResultIndex = 0;
  let runningExecutionId: string | undefined;
  let explaining = false;
  let completionCatalog: QueryCompletionCatalog | undefined;
  let languageCatalogConnectionId = "";
  let languageCatalogLoading = false;
  let languageCatalogError = "";
  let catalogRefreshToken = 0;
  let notice = "Ready";
  let errorMessage = "";

  $: activeConnection = openConnections.find((connection) => connection.profileId === activeConnectionId);
  $: activeProfile = profiles.find((profile) => profile.id === activeConnectionId);
  $: selectedResult = currentExecution?.resultSets[activeResultIndex];
  $: catalogObjectCount = completionCatalog?.namespaces.reduce((count, namespace) => count + namespace.relations.length, 0) ?? 0;
  $: if (activeConnectionId !== languageCatalogConnectionId) {
    languageCatalogConnectionId = activeConnectionId;
    explainPlan = undefined;
    if (outputMode === "plan") outputMode = "results";
    void refreshCompletionCatalog(activeConnectionId);
  }

  onMount(() => { void refresh(); });

  async function refresh(): Promise<void> {
    try {
      [profiles, openConnections, queryHistory] = await Promise.all([
        window.nublox.profiles.list(),
        window.nublox.connections.list(),
        window.nublox.history.list(80),
      ]);
      if (!openConnections.some((connection) => connection.profileId === activeConnectionId)) {
        activeConnectionId = openConnections[0]?.profileId ?? "";
      }
    } catch (error) { setError(error); }
  }

  async function refreshCompletionCatalog(connectionId = activeConnectionId): Promise<void> {
    const token = ++catalogRefreshToken;
    completionCatalog = undefined;
    languageCatalogError = "";
    if (!connectionId || !openConnections.some((connection) => connection.profileId === connectionId)) {
      languageCatalogLoading = false;
      return;
    }
    languageCatalogLoading = true;
    try {
      const snapshot = await window.nublox.queryLanguage.catalog(connectionId);
      if (token !== catalogRefreshToken || connectionId !== activeConnectionId) return;
      completionCatalog = snapshot;
    } catch (error) {
      if (token !== catalogRefreshToken) return;
      languageCatalogError = error instanceof Error ? error.message : String(error);
    } finally {
      if (token === catalogRefreshToken) languageCatalogLoading = false;
    }
  }

  async function executeSql(mode: QueryRunMode): Promise<void> {
    errorMessage = "";
    if (!activeConnectionId || !openConnections.some((item) => item.profileId === activeConnectionId)) {
      setError(new Error("Connect a database profile before executing SQL."));
      return;
    }
    const sql = mode === "statement"
      ? sqlEditor?.getCurrentStatement() ?? ""
      : mode === "selection"
        ? sqlEditor?.getSelectionText() ?? ""
        : sqlEditor?.getScriptText() ?? sqlText;
    if (!sql.trim()) {
      setError(new Error(mode === "selection" ? "Select SQL to execute first." : "There is no SQL to execute."));
      return;
    }
    const executionId = crypto.randomUUID();
    runningExecutionId = executionId;
    notice = mode === "script" ? "Executing SQL script…" : "Executing SQL…";
    try {
      currentExecution = await window.nublox.queries.execute({ executionId, connectionId: activeConnectionId, sql, mode });
      activeResultIndex = 0;
      outputMode = "results";
      notice = `Completed ${currentExecution.statementCount} statement${currentExecution.statementCount === 1 ? "" : "s"} in ${currentExecution.elapsedMs} ms.`;
      if (changesSchema(sql)) void refreshCompletionCatalog(activeConnectionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancel/i.test(message)) { notice = "Query execution cancelled."; errorMessage = ""; }
      else setError(error);
    } finally {
      runningExecutionId = undefined;
      queryHistory = await window.nublox.history.list(80).catch(() => queryHistory);
    }
  }

  async function explainSql(): Promise<void> {
    errorMessage = "";
    if (!activeConnectionId || !activeConnection) {
      setError(new Error("Connect a database profile before explaining SQL."));
      return;
    }
    const sql = sqlEditor?.getCurrentStatement() ?? "";
    if (!sql.trim()) {
      setError(new Error("There is no current SQL statement to explain."));
      return;
    }
    explaining = true;
    notice = "Building optimizer plan…";
    try {
      explainPlan = await window.nublox.queries.explain({ connectionId: activeConnectionId, sql });
      outputMode = "plan";
      notice = `Explain plan loaded · ${explainPlan.nodeCount} node${explainPlan.nodeCount === 1 ? "" : "s"}${explainPlan.queryCost !== undefined ? ` · cost ${explainPlan.queryCost}` : ""}.`;
    } catch (error) {
      setError(error);
    } finally {
      explaining = false;
    }
  }

  async function applyBuilderSql(sql: string): Promise<void> {
    sqlText = sql;
    outputMode = "results";
    await tick();
    sqlEditor?.focus();
    notice = "Visual query applied to the SQL editor.";
  }

  async function cancelQuery(): Promise<void> {
    if (!runningExecutionId) return;
    const cancelled = await window.nublox.queries.cancel(runningExecutionId);
    notice = cancelled ? "Cancelling query…" : "Query already completed.";
  }

  async function exportSelected(format: ExportFormat): Promise<void> {
    if (!selectedResult) return;
    try {
      const result = await window.nublox.results.export({
        format,
        suggestedName: `${activeProfile?.name ?? "query"}-result-${activeResultIndex + 1}.${format}`,
        resultSet: selectedResult,
      });
      if (!result.canceled) notice = `Exported results to ${result.path ?? "selected file"}.`;
    } catch (error) { setError(error); }
  }

  async function replayHistory(entry: QueryHistoryEntry): Promise<void> {
    sqlText = entry.sql;
    if (openConnections.some((connection) => connection.profileId === entry.connectionId)) activeConnectionId = entry.connectionId;
    await tick();
    sqlEditor?.focus();
    notice = "Loaded SQL from query history.";
  }

  async function clearHistory(): Promise<void> {
    if (queryHistory.length === 0 || !window.confirm("Clear all stored query history?")) return;
    try { await window.nublox.history.clear(); queryHistory = []; notice = "Query history cleared."; }
    catch (error) { setError(error); }
  }

  function displayCell(value: string | number | boolean | null): string { return value === null ? "NULL" : String(value); }
  function historyPreview(sql: string): string { return sql.replace(/\s+/gu, " ").trim(); }
  function changesSchema(sql: string): boolean { return /\b(?:create|alter|drop|rename|truncate)\b/iu.test(sql); }
  function setError(error: unknown): void { errorMessage = error instanceof Error ? error.message : String(error); notice = "Action failed."; }
</script>

<section class="sql-layout">
  <div class="sql-main">
    <div class="panel editor-panel">
      <div class="toolbar">
        <label class="connection-picker"><span>Connection</span><select bind:value={activeConnectionId} disabled={Boolean(runningExecutionId) || explaining}><option value="">Select an open connection</option>{#each openConnections as connection (connection.profileId)}{@const profile = profiles.find((item) => item.id === connection.profileId)}<option value={connection.profileId}>{profile?.name ?? connection.profileId}</option>{/each}</select></label>
        <div class="query-actions">
          <button class="quiet metadata" type="button" disabled={!activeConnection || languageCatalogLoading || explaining} onclick={() => refreshCompletionCatalog()}>{languageCatalogLoading ? "Loading metadata…" : "Refresh IntelliSense"}</button>
          <button class="secondary builder-button" type="button" disabled={!activeConnection || Boolean(runningExecutionId) || explaining} onclick={() => outputMode = "builder"}>Visual builder</button>
          <button class="secondary explain" type="button" disabled={!activeConnection || Boolean(runningExecutionId) || explaining} onclick={explainSql}>{explaining ? "Explaining…" : "Explain"}</button>
          <button class="primary" type="button" disabled={Boolean(runningExecutionId) || explaining} onclick={() => executeSql("statement")}>Run statement</button>
          <button class="secondary" type="button" disabled={Boolean(runningExecutionId) || explaining} onclick={() => executeSql("selection")}>Run selection</button>
          <button class="secondary" type="button" disabled={Boolean(runningExecutionId) || explaining} onclick={() => executeSql("script")}>Run script</button>
          <button class="stop" type="button" disabled={!runningExecutionId} onclick={cancelQuery}>Cancel</button>
        </div>
      </div>
      <div class="editor-host"><SqlEditor bind:this={sqlEditor} bind:value={sqlText} readOnly={Boolean(runningExecutionId) || explaining} providerId={activeConnection?.providerId ?? "mysql"} {completionCatalog} onRunStatement={() => executeSql("statement")} /></div>
      <div class="editor-status">
        <span>⌘/Ctrl + Enter runs current statement · ⇧⌥F formats SQL · live diagnostics enabled</span>
        <span>{#if languageCatalogError}<span class="catalog-error">IntelliSense metadata unavailable</span>{:else if completionCatalog}{completionCatalog.providerId} IntelliSense · {catalogObjectCount} objects{:else if languageCatalogLoading}Loading IntelliSense…{:else}No live metadata{/if}{#if activeConnection} · {activeConnection.latencyMs ?? "—"} ms{/if}</span>
      </div>
    </div>

    <div class="panel results-panel">
      <div class="panel-heading output-heading">
        <div class="output-switch" role="tablist" aria-label="Query output">
          <button type="button" role="tab" aria-selected={outputMode === "results"} class:active={outputMode === "results"} onclick={() => outputMode = "results"}>Results</button>
          <button type="button" role="tab" aria-selected={outputMode === "builder"} class:active={outputMode === "builder"} onclick={() => outputMode = "builder"}>Query builder</button>
          <button type="button" role="tab" aria-selected={outputMode === "plan"} class:active={outputMode === "plan"} disabled={!explainPlan} onclick={() => outputMode = "plan"}>Explain plan</button>
        </div>
        {#if outputMode === "results" && selectedResult}<div><button class="quiet" type="button" onclick={() => exportSelected("csv")}>Export CSV</button><button class="quiet" type="button" onclick={() => exportSelected("json")}>Export JSON</button></div>{/if}
        {#if outputMode === "plan" && explainPlan}<div class="plan-summary">{explainPlan.nodeCount} nodes{#if explainPlan.queryCost !== undefined} · cost {explainPlan.queryCost}{/if}</div>{/if}
        {#if outputMode === "builder"}<div class="plan-summary">{catalogObjectCount} live objects</div>{/if}
      </div>

      {#if outputMode === "builder"}
        <div class="builder-host"><VisualQueryBuilder catalog={completionCatalog} onApply={(sql) => void applyBuilderSql(sql)} /></div>
      {:else if outputMode === "plan"}
        {#if explainPlan}<div class="plan-host"><QueryPlanViewer plan={explainPlan} /></div>{:else}<div class="empty-state">Explain the current statement to visualize its optimizer plan.</div>{/if}
      {:else if currentExecution && currentExecution.resultSets.length > 0}
        <div class="result-tabs">{#each currentExecution.resultSets as resultSet, index}<button type="button" class:active={activeResultIndex === index} onclick={() => (activeResultIndex = index)}>Result {index + 1}{#if resultSet.rows.length}<small>{resultSet.rows.length} rows</small>{/if}</button>{/each}</div>
        {#if selectedResult}
          {#if selectedResult.columns.length > 0}
            <div class="result-grid"><table><thead><tr>{#each selectedResult.columns as column}<th>{column.name}</th>{/each}</tr></thead><tbody>{#each selectedResult.rows as row}<tr>{#each selectedResult.columns as column}<td class:null={row[column.name] === null}>{displayCell(row[column.name] ?? null)}</td>{/each}</tr>{/each}</tbody></table></div>
          {:else}
            <div class="dml-summary"><strong>Statement completed</strong><span>Affected rows: {selectedResult.affectedRows ?? 0}</span>{#if selectedResult.changedRows !== undefined}<span>Changed rows: {selectedResult.changedRows}</span>{/if}{#if selectedResult.warningCount !== undefined}<span>Warnings: {selectedResult.warningCount}</span>{/if}{#if selectedResult.message}<p>{selectedResult.message}</p>{/if}</div>
          {/if}
        {/if}
      {:else}<div class="empty-state">No results yet.</div>{/if}
    </div>
  </div>

  <aside class="panel history-panel">
    <div class="panel-heading"><div><h2>Query history</h2><p>{queryHistory.length} recent execution{queryHistory.length === 1 ? "" : "s"}</p></div><button class="quiet" type="button" onclick={clearHistory} disabled={queryHistory.length === 0}>Clear</button></div>
    <div class="history-list">
      {#if queryHistory.length === 0}<div class="empty-state">Execution history will appear here.</div>{:else}
        {#each queryHistory as entry (entry.id)}<button class="history-entry" type="button" onclick={() => replayHistory(entry)}><span class="history-status" class:success={entry.status === "success"} class:error={entry.status === "error"} class:cancelled={entry.status === "cancelled"}></span><span><strong>{historyPreview(entry.sql)}</strong><small>{entry.connectionId} · {entry.elapsedMs} ms · {entry.status}</small></span></button>{/each}
      {/if}
    </div>
  </aside>
</section>
<footer class="activity-bar" class:error={Boolean(errorMessage)}><span class="activity-indicator"></span><span>{errorMessage || notice}</span>{#if runningExecutionId}<span class="busy">Executing…</span>{:else if explaining}<span class="busy">Explaining…</span>{/if}</footer>

<style>
  .sql-layout{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 285px;gap:16px;padding:20px 22px}.sql-main{min-width:0;display:grid;grid-template-rows:minmax(360px,.92fr) minmax(300px,.78fr);gap:16px}.panel{min-width:0;overflow:hidden;border:1px solid #1e3044;border-radius:11px;background:rgba(13,25,41,.86)}.editor-panel{display:flex;flex-direction:column}.toolbar{display:flex;justify-content:space-between;gap:14px;align-items:end;padding:12px 14px;border-bottom:1px solid #1b2c3f}.connection-picker{min-width:230px}.connection-picker span{display:block;margin-bottom:5px;color:#6f849d;font-size:9px;text-transform:uppercase}.connection-picker select{width:100%;border:1px solid #263a52;border-radius:7px;padding:7px 9px;background:#0b1726;color:#dce7f3}.query-actions{display:flex;gap:7px;align-items:center}.primary,.secondary,.quiet,.stop{border-radius:7px;padding:8px 11px;cursor:pointer;font-size:10px;font-weight:650}.primary{border:1px solid #4a86dd;background:#3477d8;color:#fff}.secondary{border:1px solid #304966;background:#14263b;color:#bfd0e3}.secondary.explain{border-color:#476481;color:#b5d3ed}.secondary.builder-button{border-color:#385779;color:#a8c8e5}.quiet{border:1px solid transparent;background:transparent;color:#7991ad}.quiet.metadata{border-color:#273e58;background:#101f32;color:#8ca5c1}.stop{border:1px solid #703944;background:#2b151c;color:#e58b98}.primary:disabled,.secondary:disabled,.quiet:disabled,.stop:disabled{cursor:not-allowed;opacity:.45}.editor-host{flex:1;min-height:280px}.editor-status{display:flex;justify-content:space-between;gap:20px;padding:6px 12px;border-top:1px solid #1b2c3f;color:#627891;font-size:9px}.catalog-error{color:#d68a95}.panel-heading{display:flex;justify-content:space-between;align-items:center;padding:13px 15px;border-bottom:1px solid #1b2c3f}.panel-heading h2{margin:0 0 2px;color:#e9f1fb;font-size:13px}.panel-heading p{margin:0;color:#687e98;font-size:9px}.output-heading{min-height:48px;padding-top:8px;padding-bottom:8px}.output-switch{display:flex;gap:4px}.output-switch button{border:1px solid transparent;border-radius:6px;padding:6px 9px;background:transparent;color:#6f849d;font-size:10px;font-weight:650;cursor:pointer}.output-switch button.active{border-color:#2f4b69;background:#14283f;color:#d7e6f4}.output-switch button:disabled{cursor:not-allowed;opacity:.4}.plan-summary{color:#7088a1;font-size:9px}.plan-host,.builder-host{height:calc(100% - 49px);min-height:240px}.result-tabs{display:flex;gap:2px;overflow-x:auto;padding:8px 10px 0}.result-tabs button{border:0;border-radius:6px 6px 0 0;padding:7px 10px;background:#0b1726;color:#7790ad;font-size:9px}.result-tabs button.active{background:#172b43;color:#dce8f7}.result-tabs small{margin-left:6px;color:#57708e}.result-grid{height:calc(100% - 82px);overflow:auto;border-top:1px solid #1b2c3f}table{width:max-content;min-width:100%;border-collapse:collapse;font-size:10px}th,td{padding:7px 9px;border-right:1px solid #1b2b3d;border-bottom:1px solid #18283a;text-align:left;white-space:nowrap}th{position:sticky;top:0;background:#102036;color:#92a9c4}td{color:#c3d1e2;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}td.null{color:#5e7188;font-style:italic}.dml-summary{display:flex;gap:18px;align-items:center;padding:24px;color:#8096b0;font-size:10px}.dml-summary strong{color:#bcd0e5}.dml-summary p{margin:0}.history-panel{min-height:0}.history-list{height:calc(100% - 60px);overflow:auto;padding:6px}.history-entry{width:100%;display:grid;grid-template-columns:8px 1fr;gap:8px;border:0;border-radius:7px;padding:9px 7px;background:transparent;color:inherit;text-align:left}.history-entry:hover{background:#12233a}.history-entry strong,.history-entry small{display:block;overflow:hidden;text-overflow:ellipsis}.history-entry strong{color:#c6d5e6;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:9px;font-weight:500;line-height:1.4;white-space:nowrap}.history-entry small{margin-top:4px;color:#617891;font-size:8px;white-space:nowrap}.history-status{width:6px;height:6px;margin-top:3px;border-radius:50%;background:#66768a}.history-status.success{background:#40c58b}.history-status.error{background:#d55767}.history-status.cancelled{background:#d9a55d}.empty-state{padding:35px;color:#71859d;text-align:center;font-size:10px}.activity-bar{min-height:29px;display:flex;gap:8px;align-items:center;padding:6px 22px;border-top:1px solid #1a2a3e;background:#091422;color:#7489a2;font-size:9px}.activity-bar.error{color:#de8995}.activity-indicator{width:6px;height:6px;border-radius:50%;background:#4d83c9}.busy{margin-left:auto}@media(max-width:1180px){.sql-layout{grid-template-columns:minmax(0,1fr) 240px}.query-actions{flex-wrap:wrap;justify-content:flex-end}}
</style>

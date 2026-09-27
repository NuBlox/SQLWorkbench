<script lang="ts">
  import { onMount } from "svelte";
  import type {
    DatabaseServerSession,
    DatabaseServerStatus,
    DatabaseServerVariable,
    OpenConnectionInfo,
  } from "$lib/desktop-api";

  type Tab = "sessions" | "variables" | "status";

  let connections: readonly OpenConnectionInfo[] = [];
  let connectionId = "";
  let tab: Tab = "sessions";
  let filter = "";
  let sessions: readonly DatabaseServerSession[] = [];
  let variables: readonly DatabaseServerVariable[] = [];
  let status: readonly DatabaseServerStatus[] = [];
  let loading = false;
  let errorMessage = "";
  let refreshedAt = "";

  $: filteredSessions = filter.trim()
    ? sessions.filter((item) => sessionSearchText(item).includes(filter.trim().toLowerCase()))
    : sessions;
  $: activeQueries = sessions.filter((item) => item.command.toLowerCase() === "query").length;
  $: sleepingSessions = sessions.filter((item) => item.command.toLowerCase() === "sleep").length;

  onMount(() => { void refreshConnections(); });

  async function refreshConnections(): Promise<void> {
    errorMessage = "";
    try {
      connections = await window.nublox.connections.list();
      if (!connections.some((item) => item.id === connectionId)) connectionId = connections[0]?.id ?? "";
      if (connectionId) await refresh();
    } catch (error) {
      setError(error);
    }
  }

  async function changeConnection(): Promise<void> {
    sessions = [];
    variables = [];
    status = [];
    if (connectionId) await refresh();
  }

  async function changeTab(next: Tab): Promise<void> {
    tab = next;
    filter = "";
    await refresh();
  }

  async function refresh(): Promise<void> {
    if (!connectionId) return;
    loading = true;
    errorMessage = "";
    try {
      if (tab === "sessions") sessions = await window.nublox.administration.sessions(connectionId);
      else if (tab === "variables") variables = await window.nublox.administration.variables({ connectionId, ...(filter.trim() ? { filter } : {}) });
      else status = await window.nublox.administration.status({ connectionId, ...(filter.trim() ? { filter } : {}) });
      refreshedAt = new Date().toLocaleTimeString();
    } catch (error) {
      setError(error);
    } finally {
      loading = false;
    }
  }

  async function applyFilter(): Promise<void> {
    if (tab === "sessions") return;
    await refresh();
  }

  function sessionSearchText(item: DatabaseServerSession): string {
    return [item.id, item.user, item.host, item.database, item.command, item.state, item.statement].filter(Boolean).join(" ").toLowerCase();
  }

  function setError(error: unknown): void {
    errorMessage = error instanceof Error ? error.message : String(error);
  }
</script>

<section class="admin-shell">
  <div class="toolbar">
    <label>
      <span>Open connection</span>
      <select bind:value={connectionId} onchange={() => void changeConnection()} disabled={loading || connections.length === 0}>
        {#if connections.length === 0}<option value="">No open connections</option>{/if}
        {#each connections as connection}<option value={connection.id}>{connection.id} · {connection.providerId}</option>{/each}
      </select>
    </label>
    <label class="filter">
      <span>Filter</span>
      <input bind:value={filter} placeholder={tab === "sessions" ? "user, database, state or SQL" : "name or value"} onkeydown={(event) => { if (event.key === "Enter") void applyFilter(); }} />
    </label>
    <button class="secondary" type="button" onclick={() => void refreshConnections()} disabled={loading}>Connections</button>
    <button class="primary" type="button" onclick={() => void refresh()} disabled={loading || !connectionId}>{loading ? "Refreshing…" : "Refresh"}</button>
  </div>

  {#if connections.length === 0}
    <div class="empty">
      <strong>Open a database connection first</strong>
      <span>Administration operates against an existing live Workbench session.</span>
    </div>
  {:else}
    <div class="summary-grid">
      <article><span>Server sessions</span><strong>{sessions.length}</strong><small>{activeQueries} active queries</small></article>
      <article><span>Sleeping</span><strong>{sleepingSessions}</strong><small>idle client sessions</small></article>
      <article><span>Variables loaded</span><strong>{variables.length}</strong><small>global server configuration</small></article>
      <article><span>Status values</span><strong>{status.length}</strong><small>{refreshedAt ? `refreshed ${refreshedAt}` : "not loaded"}</small></article>
    </div>

    <div class="panel">
      <div class="tabs" role="tablist" aria-label="Administration views">
        <button class:active={tab === "sessions"} type="button" onclick={() => void changeTab("sessions")}>Sessions / Processes</button>
        <button class:active={tab === "variables"} type="button" onclick={() => void changeTab("variables")}>Server Variables</button>
        <button class:active={tab === "status"} type="button" onclick={() => void changeTab("status")}>Server Status</button>
      </div>

      {#if errorMessage}<div class="error">{errorMessage}</div>{/if}

      {#if tab === "sessions"}
        <div class="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>User</th><th>Host</th><th>Database</th><th>Command</th><th>Seconds</th><th>State</th><th>Statement</th></tr></thead>
            <tbody>
              {#each filteredSessions as item}
                <tr>
                  <td class="mono">{item.id}</td><td>{item.user}</td><td>{item.host ?? "—"}</td><td>{item.database ?? "—"}</td>
                  <td><span class:active-query={item.command.toLowerCase() === "query"} class="command">{item.command}</span></td>
                  <td class="numeric">{item.timeSeconds}</td><td>{item.state ?? "—"}</td><td class="statement" title={item.statement ?? ""}>{item.statement ?? "—"}</td>
                </tr>
              {:else}
                <tr><td colspan="8" class="table-empty">No visible server sessions match this view.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        {@const items = tab === "variables" ? variables : status}
        <div class="table-wrap">
          <table class="key-value">
            <thead><tr><th>Name</th><th>Value</th></tr></thead>
            <tbody>
              {#each items as item}
                <tr><td class="mono name">{item.name}</td><td class="mono value">{item.value}</td></tr>
              {:else}
                <tr><td colspan="2" class="table-empty">No values loaded. Use Refresh or enter a filter and press Enter.</td></tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .admin-shell{padding:16px 22px 24px;display:grid;gap:14px;min-height:0}.toolbar{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.toolbar label{display:grid;gap:5px;min-width:220px}.toolbar label.filter{flex:1;min-width:260px}.toolbar span{color:#748aa4;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.toolbar input,.toolbar select{height:36px;border:1px solid #263b54;border-radius:7px;padding:0 10px;background:#0c1929;color:#dce8f6;outline:none}.toolbar input:focus,.toolbar select:focus{border-color:#467fc8}.toolbar button{height:36px;border-radius:7px;padding:0 13px;cursor:pointer}.primary{border:1px solid #3d81de;background:#3478d4;color:#fff}.secondary{border:1px solid #2a4059;background:#101f31;color:#9fb2c9}.toolbar button:disabled{opacity:.5;cursor:default}.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.summary-grid article{border:1px solid #1e3044;border-radius:9px;padding:13px 14px;background:#0c1827}.summary-grid span,.summary-grid small{display:block;color:#71869f;font-size:10px}.summary-grid strong{display:block;margin:4px 0;color:#f1f6fc;font-size:23px}.panel{min-height:420px;border:1px solid #1e3044;border-radius:10px;overflow:hidden;background:#0b1726}.tabs{display:flex;gap:4px;padding:9px 10px;border-bottom:1px solid #1e3044;background:#0e1b2b}.tabs button{border:0;border-radius:6px;padding:8px 11px;background:transparent;color:#8297af;cursor:pointer}.tabs button.active{background:#182b42;color:#e5eef9}.error{margin:12px;border:1px solid #6b3240;border-radius:7px;padding:10px 12px;background:#2a151d;color:#ef9ead;font-size:12px}.table-wrap{overflow:auto;max-height:560px}table{width:100%;border-collapse:collapse;font-size:11px}th{position:sticky;top:0;z-index:1;padding:9px 10px;border-bottom:1px solid #24364b;background:#101d2e;color:#7188a3;text-align:left;font-size:9px;letter-spacing:.08em;text-transform:uppercase}td{padding:9px 10px;border-bottom:1px solid #16283a;color:#b8c8da;vertical-align:top}tr:hover td{background:#0e1d2f}.mono{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace}.numeric{text-align:right}.statement{max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.command{display:inline-block;border:1px solid #2e435b;border-radius:999px;padding:2px 7px;color:#91a5bb}.command.active-query{border-color:#285d9f;color:#74aef8;background:#10294a}.key-value .name{width:35%;color:#8eb6eb}.key-value .value{white-space:pre-wrap;word-break:break-word}.table-empty{padding:36px;text-align:center;color:#60758e}.empty{display:grid;place-items:center;gap:5px;min-height:360px;border:1px dashed #2b4058;border-radius:10px;background:#0a1624;color:#d8e5f3}.empty span{color:#71869f;font-size:12px}@media(max-width:1200px){.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>

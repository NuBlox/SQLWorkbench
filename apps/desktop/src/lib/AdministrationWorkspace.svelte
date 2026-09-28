<script lang="ts">
  import { onMount } from "svelte";
  import type {
    DatabaseLockWait,
    DatabaseServerSession,
    DatabaseServerStatus,
    DatabaseServerVariable,
    OpenConnectionInfo,
  } from "$lib/desktop-api";

  type Tab = "sessions" | "locks" | "variables" | "status";

  let connections: readonly OpenConnectionInfo[] = [];
  let connectionId = "";
  let tab: Tab = "sessions";
  let filter = "";
  let sessions: readonly DatabaseServerSession[] = [];
  let lockWaits: readonly DatabaseLockWait[] = [];
  let variables: readonly DatabaseServerVariable[] = [];
  let status: readonly DatabaseServerStatus[] = [];
  let loading = false;
  let errorMessage = "";
  let refreshedAt = "";

  $: normalizedFilter = filter.trim().toLowerCase();
  $: filteredSessions = normalizedFilter
    ? sessions.filter((item) => sessionSearchText(item).includes(normalizedFilter))
    : sessions;
  $: filteredLockWaits = normalizedFilter
    ? lockWaits.filter((item) => lockSearchText(item).includes(normalizedFilter))
    : lockWaits;
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
    lockWaits = [];
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
      else if (tab === "locks") lockWaits = await window.nublox.administration.locks(connectionId);
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
    if (tab === "sessions" || tab === "locks") return;
    await refresh();
  }

  function filterPlaceholder(): string {
    if (tab === "sessions") return "user, database, state or SQL";
    if (tab === "locks") return "waiting/blocking session, object, lock mode or SQL";
    return "name or value";
  }

  function sessionSearchText(item: DatabaseServerSession): string {
    return [item.id, item.user, item.host, item.database, item.command, item.state, item.statement].filter(Boolean).join(" ").toLowerCase();
  }

  function lockSearchText(item: DatabaseLockWait): string {
    return [item.waitingSessionId, item.blockingSessionId, item.object, item.lockType, item.lockMode, item.waitSeconds, item.statement].filter((value) => value !== undefined && value !== null).join(" ").toLowerCase();
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
      <input bind:value={filter} placeholder={filterPlaceholder()} onkeydown={(event) => { if (event.key === "Enter") void applyFilter(); }} />
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
      <article><span>Server sessions</span><strong>{sessions.length}</strong><small>{sleepingSessions} sleeping</small></article>
      <article><span>Active queries</span><strong>{activeQueries}</strong><small>visible processlist queries</small></article>
      <article class:attention={lockWaits.length > 0}><span>Lock waits</span><strong>{lockWaits.length}</strong><small>{lockWaits.length ? "blocking detected" : "none loaded"}</small></article>
      <article><span>Last refresh</span><strong class="time-value">{refreshedAt || "—"}</strong><small>current administration view</small></article>
    </div>

    <div class="panel">
      <div class="tabs" role="tablist" aria-label="Administration views">
        <button class:active={tab === "sessions"} type="button" onclick={() => void changeTab("sessions")}>Sessions / Processes</button>
        <button class:active={tab === "locks"} type="button" onclick={() => void changeTab("locks")}>Locks / Blocking</button>
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
      {:else if tab === "locks"}
        <div class="table-wrap">
          <table>
            <thead><tr><th>Waiting</th><th>Blocking</th><th>Object</th><th>Type</th><th>Mode</th><th>Wait (s)</th><th>Waiting statement</th></tr></thead>
            <tbody>
              {#each filteredLockWaits as item}
                <tr class="lock-row">
                  <td><span class="waiter mono">{item.waitingSessionId}</span></td>
                  <td><span class="blocker mono">{item.blockingSessionId ?? "—"}</span></td>
                  <td class="mono">{item.object ?? "—"}</td>
                  <td>{item.lockType ?? "—"}</td>
                  <td class="mono">{item.lockMode ?? "—"}</td>
                  <td class="numeric">{item.waitSeconds ?? "—"}</td>
                  <td class="statement" title={item.statement ?? ""}>{item.statement ?? "—"}</td>
                </tr>
              {:else}
                <tr><td colspan="7" class="table-empty">No lock waits are currently visible. Refresh while blocking is occurring to capture the wait graph.</td></tr>
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
  .admin-shell{padding:16px 22px 24px;display:grid;gap:14px;min-height:0}.toolbar{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.toolbar label{display:grid;gap:5px;min-width:220px}.toolbar label.filter{flex:1;min-width:260px}.toolbar span{color:#748aa4;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}.toolbar input,.toolbar select{height:36px;border:1px solid #263b54;border-radius:7px;padding:0 10px;background:#0c1929;color:#dce8f6;outline:none}.toolbar input:focus,.toolbar select:focus{border-color:#467fc8}.toolbar button{height:36px;border-radius:7px;padding:0 13px;cursor:pointer}.primary{border:1px solid #3d81de;background:#3478d4;color:#fff}.secondary{border:1px solid #2a4059;background:#101f31;color:#9fb2c9}.toolbar button:disabled{opacity:.5;cursor:default}.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.summary-grid article{border:1px solid #1e3044;border-radius:9px;padding:13px 14px;background:#0c1827}.summary-grid article.attention{border-color:#76424a;background:#1b151e}.summary-grid span,.summary-grid small{display:block;color:#71869f;font-size:10px}.summary-grid article.attention span,.summary-grid article.attention small{color:#c68992}.summary-grid strong{display:block;margin:4px 0;color:#f1f6fc;font-size:23px}.summary-grid .time-value{font-size:17px;line-height:28px}.panel{min-height:420px;border:1px solid #1e3044;border-radius:10px;overflow:hidden;background:#0b1726}.tabs{display:flex;gap:4px;padding:9px 10px;border-bottom:1px solid #1e3044;background:#0e1b2b}.tabs button{border:0;border-radius:6px;padding:8px 11px;background:transparent;color:#8297af;cursor:pointer}.tabs button.active{background:#182b42;color:#e5eef9}.error{margin:12px;border:1px solid #6b3240;border-radius:7px;padding:10px 12px;background:#2a151d;color:#ef9ead;font-size:12px}.table-wrap{overflow:auto;max-height:560px}table{width:100%;border-collapse:collapse;font-size:11px}th{position:sticky;top:0;z-index:1;padding:9px 10px;border-bottom:1px solid #24364b;background:#101d2e;color:#7188a3;text-align:left;font-size:9px;letter-spacing:.08em;text-transform:uppercase}td{padding:9px 10px;border-bottom:1px solid #16283a;color:#b8c8da;vertical-align:top}tr:hover td{background:#0e1d2f}.lock-row td{background:rgba(75,34,43,.08)}.mono{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace}.numeric{text-align:right}.statement{max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.command{display:inline-block;border:1px solid #2e435b;border-radius:999px;padding:2px 7px;color:#91a5bb}.command.active-query{border-color:#285d9f;color:#74aef8;background:#10294a}.waiter,.blocker{display:inline-block;border-radius:5px;padding:2px 6px}.waiter{border:1px solid #765a2a;background:#231e12;color:#d5ad63}.blocker{border:1px solid #71333f;background:#28131b;color:#ed9bad}.key-value .name{width:35%;color:#8eb6eb}.key-value .value{white-space:pre-wrap;word-break:break-word}.table-empty{padding:36px;text-align:center;color:#60758e}.empty{display:grid;place-items:center;gap:5px;min-height:360px;border:1px dashed #2b4058;border-radius:10px;background:#0a1624;color:#d8e5f3}.empty span{color:#71869f;font-size:12px}@media(max-width:1200px){.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style>

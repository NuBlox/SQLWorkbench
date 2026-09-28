<script lang="ts">
  import { onMount } from "svelte";
  import type {
    DatabaseAccount, DatabaseAdministrationPreview, DatabaseBackupHook, DatabaseLockWait, DatabasePrivilegeGrant,
    DatabasePrivilegeScope, DatabaseRoleMembership, DatabaseSecurityChange, DatabaseServerSession, DatabaseServerStatus,
    DatabaseServerVariable, DatabaseStorageSummary, DatabaseTableCompareResult,
  } from "@nublox/workbench-provider-api";
  import type { OpenConnectionInfo } from "$lib/desktop-api";

  type Tab = "sessions" | "locks" | "variables" | "status" | "security" | "storage" | "data" | "backup";
  type SecurityKind = DatabaseSecurityChange["kind"];

  const privileges = ["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "INDEX", "EXECUTE", "CREATE VIEW", "SHOW VIEW", "TRIGGER", "EVENT", "PROCESS", "ALL PRIVILEGES"] as const;

  let connections: readonly OpenConnectionInfo[] = [];
  let connectionId = "";
  let tab: Tab = "sessions";
  let filter = "";
  let sessions: readonly DatabaseServerSession[] = [];
  let lockWaits: readonly DatabaseLockWait[] = [];
  let variables: readonly DatabaseServerVariable[] = [];
  let status: readonly DatabaseServerStatus[] = [];
  let accounts: readonly DatabaseAccount[] = [];
  let roles: readonly DatabaseRoleMembership[] = [];
  let grants: readonly DatabasePrivilegeGrant[] = [];
  let storage: readonly DatabaseStorageSummary[] = [];
  let backupHooks: readonly DatabaseBackupHook[] = [];
  let loading = false;
  let errorMessage = "";
  let successMessage = "";
  let refreshedAt = "";

  let securityKind: SecurityKind = "grant-privilege";
  let grantee = "";
  let role = "";
  let privilege = "SELECT";
  let scope: DatabasePrivilegeScope = "global";
  let securityCatalog = "";
  let securityTable = "";
  let grantOption = false;
  let securityPreview: DatabaseAdministrationPreview | undefined;
  let securityConfirmation = "";

  let sourceCatalog = "";
  let sourceTable = "";
  let targetCatalog = "";
  let targetTable = "";
  let rowLimit = 10000;
  let truncateTarget = false;
  let transferConfirmation = "";
  let compareResult: DatabaseTableCompareResult | undefined;

  $: normalizedFilter = filter.trim().toLowerCase();
  $: filteredSessions = normalizedFilter ? sessions.filter((item) => sessionSearchText(item).includes(normalizedFilter)) : sessions;
  $: filteredLockWaits = normalizedFilter ? lockWaits.filter((item) => lockSearchText(item).includes(normalizedFilter)) : lockWaits;
  $: activeQueries = sessions.filter((item) => item.command.toLowerCase() === "query").length;
  $: sleepingSessions = sessions.filter((item) => item.command.toLowerCase() === "sleep").length;
  $: roleAccounts = accounts.filter((item) => item.kind === "role");
  $: isRoleChange = securityKind === "grant-role" || securityKind === "revoke-role";

  onMount(() => { void refreshConnections(); });

  async function refreshConnections(): Promise<void> {
    resetMessages();
    try {
      connections = await window.nublox.connections.list();
      if (!connections.some((item) => item.id === connectionId)) connectionId = connections[0]?.id ?? "";
      if (connectionId) await refresh();
    } catch (error) { setError(error); }
  }

  async function changeConnection(): Promise<void> {
    sessions = []; lockWaits = []; variables = []; status = []; accounts = []; roles = []; grants = []; storage = []; backupHooks = [];
    securityPreview = undefined; compareResult = undefined;
    if (connectionId) await refresh();
  }

  async function changeTab(next: Tab): Promise<void> { tab = next; filter = ""; resetMessages(); await refresh(); }

  async function refresh(): Promise<void> {
    if (!connectionId) return;
    loading = true; resetMessages();
    try {
      if (tab === "sessions") sessions = await window.nublox.administration.sessions(connectionId);
      else if (tab === "locks") lockWaits = await window.nublox.administration.locks(connectionId);
      else if (tab === "variables") variables = await window.nublox.administration.variables({ connectionId, ...(filter.trim() ? { filter } : {}) });
      else if (tab === "status") status = await window.nublox.administration.status({ connectionId, ...(filter.trim() ? { filter } : {}) });
      else if (tab === "security") {
        [accounts, roles, grants] = await Promise.all([window.nubloxOperations.accounts(connectionId), window.nubloxOperations.roles(connectionId), window.nubloxOperations.privileges(connectionId)]);
        if (!grantee && accounts[0]) grantee = accounts[0].grantee;
        if (!role && roleAccounts[0]) role = roleAccounts[0].grantee;
      } else if (tab === "storage") storage = await window.nubloxOperations.storage(connectionId);
      else if (tab === "backup") backupHooks = await window.nubloxOperations.backupHooks(connectionId);
      refreshedAt = new Date().toLocaleTimeString();
    } catch (error) { setError(error); }
    finally { loading = false; }
  }

  async function applyFilter(): Promise<void> { if (tab === "variables" || tab === "status") await refresh(); }

  function buildSecurityChange(): DatabaseSecurityChange {
    if (!grantee) throw new Error("Select a grantee first.");
    if (securityKind === "grant-role" || securityKind === "revoke-role") {
      if (!role) throw new Error("Select a role first.");
      return securityKind === "grant-role" ? { kind: "grant-role", grantee, role, adminOption: grantOption } : { kind: "revoke-role", grantee, role };
    }
    const base = { grantee, privilege, scope, ...(scope !== "global" ? { catalog: securityCatalog.trim() } : {}), ...(scope === "table" ? { table: securityTable.trim() } : {}) };
    return securityKind === "grant-privilege" ? { kind: "grant-privilege", ...base, withGrantOption: grantOption } : { kind: "revoke-privilege", ...base };
  }

  async function previewSecurity(): Promise<void> {
    if (!connectionId) return;
    loading = true; resetMessages(); securityConfirmation = "";
    try { securityPreview = await window.nubloxOperations.previewSecurity({ connectionId, change: buildSecurityChange() }); }
    catch (error) { setError(error); }
    finally { loading = false; }
  }

  async function applySecurity(): Promise<void> {
    if (!connectionId || !securityPreview) return;
    loading = true; resetMessages();
    try {
      await window.nubloxOperations.executeSecurity({ connectionId, change: buildSecurityChange(), confirmation: securityConfirmation });
      successMessage = "Security change applied."; securityPreview = undefined; securityConfirmation = "";
      [accounts, roles, grants] = await Promise.all([window.nubloxOperations.accounts(connectionId), window.nubloxOperations.roles(connectionId), window.nubloxOperations.privileges(connectionId)]);
    } catch (error) { setError(error); }
    finally { loading = false; }
  }

  async function exportTable(): Promise<void> {
    if (!connectionId) return;
    loading = true; resetMessages();
    try { const result = await window.nubloxOperations.exportTable({ connectionId, catalog: sourceCatalog, table: sourceTable, limit: rowLimit }); if (!result.canceled) successMessage = `Exported ${result.rows ?? 0} rows${result.path ? ` to ${result.path}` : ""}.`; }
    catch (error) { setError(error); }
    finally { loading = false; }
  }

  async function importTable(): Promise<void> {
    if (!connectionId) return;
    loading = true; resetMessages();
    try { const result = await window.nubloxOperations.importTable({ connectionId, ...(targetCatalog.trim() ? { catalog: targetCatalog } : {}), ...(targetTable.trim() ? { table: targetTable } : {}), truncateTarget }); if (!result.canceled) successMessage = `Imported ${result.result?.rowsWritten ?? 0} rows into ${result.result?.target ?? "target"}.`; }
    catch (error) { setError(error); }
    finally { loading = false; }
  }

  async function compareTables(): Promise<void> {
    if (!connectionId) return;
    loading = true; resetMessages();
    try { compareResult = await window.nubloxOperations.compare({ connectionId, leftCatalog: sourceCatalog, leftTable: sourceTable, rightCatalog: targetCatalog, rightTable: targetTable }); }
    catch (error) { setError(error); }
    finally { loading = false; }
  }

  async function transferTable(): Promise<void> {
    if (!connectionId) return;
    loading = true; resetMessages();
    try { const result = await window.nubloxOperations.transfer({ connectionId, sourceCatalog, sourceTable, targetCatalog, targetTable, limit: rowLimit, truncateTarget, confirmation: transferConfirmation }); successMessage = `Transferred ${result.rowsWritten} rows to ${result.target}.`; compareResult = undefined; transferConfirmation = ""; }
    catch (error) { setError(error); }
    finally { loading = false; }
  }

  function filterPlaceholder(): string { if (tab === "sessions") return "user, database, state or SQL"; if (tab === "locks") return "waiting/blocking session, object, lock mode or SQL"; if (tab === "variables" || tab === "status") return "name or value"; return "filter is available for live process/status views"; }
  function sessionSearchText(item: DatabaseServerSession): string { return [item.id,item.user,item.host,item.database,item.command,item.state,item.statement].filter(Boolean).join(" ").toLowerCase(); }
  function lockSearchText(item: DatabaseLockWait): string { return [item.waitingSessionId,item.blockingSessionId,item.object,item.lockType,item.lockMode,item.waitSeconds,item.statement].filter((value) => value !== undefined && value !== null).join(" ").toLowerCase(); }
  function bytes(value: number): string { if (value < 1024) return `${value} B`; const units = ["KB","MB","GB","TB"]; let current = value / 1024; let unit = 0; while (current >= 1024 && unit < units.length - 1) { current /= 1024; unit += 1; } return `${current.toFixed(current >= 10 ? 1 : 2)} ${units[unit]}`; }
  function resetMessages(): void { errorMessage = ""; successMessage = ""; }
  function setError(error: unknown): void { errorMessage = error instanceof Error ? error.message : String(error); }
</script>

<section class="admin-shell">
  <div class="toolbar">
    <label><span>Open connection</span><select bind:value={connectionId} onchange={() => void changeConnection()} disabled={loading || connections.length === 0}>{#if connections.length === 0}<option value="">No open connections</option>{/if}{#each connections as connection}<option value={connection.id}>{connection.id} · {connection.providerId}</option>{/each}</select></label>
    <label class="filter"><span>Filter</span><input bind:value={filter} placeholder={filterPlaceholder()} onkeydown={(event) => { if (event.key === "Enter") void applyFilter(); }} /></label>
    <button class="secondary" type="button" onclick={() => void refreshConnections()} disabled={loading}>Connections</button>
    <button class="primary" type="button" onclick={() => void refresh()} disabled={loading || !connectionId}>{loading ? "Working…" : "Refresh"}</button>
  </div>

  {#if connections.length === 0}
    <div class="empty"><strong>Open a database connection first</strong><span>Administration operates against an existing live Workbench session.</span></div>
  {:else}
    <div class="summary-grid">
      <article><span>Server sessions</span><strong>{sessions.length}</strong><small>{sleepingSessions} sleeping</small></article>
      <article><span>Active queries</span><strong>{activeQueries}</strong><small>visible processlist queries</small></article>
      <article class:attention={lockWaits.length > 0}><span>Lock waits</span><strong>{lockWaits.length}</strong><small>{lockWaits.length ? "blocking detected" : "none visible"}</small></article>
      <article><span>Last refresh</span><strong class="time-value">{refreshedAt || "—"}</strong><small>current administration view</small></article>
    </div>

    <div class="panel">
      <div class="tabs" role="tablist" aria-label="Administration views">
        <button class:active={tab === "sessions"} type="button" onclick={() => void changeTab("sessions")}>Sessions</button>
        <button class:active={tab === "locks"} type="button" onclick={() => void changeTab("locks")}>Locks</button>
        <button class:active={tab === "variables"} type="button" onclick={() => void changeTab("variables")}>Variables</button>
        <button class:active={tab === "status"} type="button" onclick={() => void changeTab("status")}>Status</button>
        <button class:active={tab === "security"} type="button" onclick={() => void changeTab("security")}>Users / Roles / Privileges</button>
        <button class:active={tab === "storage"} type="button" onclick={() => void changeTab("storage")}>Storage</button>
        <button class:active={tab === "data"} type="button" onclick={() => void changeTab("data")}>Data Operations</button>
        <button class:active={tab === "backup"} type="button" onclick={() => void changeTab("backup")}>Backup Hooks</button>
      </div>

      {#if errorMessage}<div class="message error">{errorMessage}</div>{/if}
      {#if successMessage}<div class="message success">{successMessage}</div>{/if}

      {#if tab === "sessions"}
        <div class="table-wrap"><table><thead><tr><th>ID</th><th>User</th><th>Host</th><th>Database</th><th>Command</th><th>Seconds</th><th>State</th><th>Statement</th></tr></thead><tbody>{#each filteredSessions as item}<tr><td class="mono">{item.id}</td><td>{item.user}</td><td>{item.host ?? "—"}</td><td>{item.database ?? "—"}</td><td>{item.command}</td><td class="numeric">{item.timeSeconds}</td><td>{item.state ?? "—"}</td><td class="statement">{item.statement ?? "—"}</td></tr>{:else}<tr><td colspan="8" class="table-empty">No visible sessions.</td></tr>{/each}</tbody></table></div>
      {:else if tab === "locks"}
        <div class="table-wrap"><table><thead><tr><th>Waiting</th><th>Blocking</th><th>Object</th><th>Type</th><th>Mode</th><th>Wait (s)</th><th>Statement</th></tr></thead><tbody>{#each filteredLockWaits as item}<tr><td class="mono">{item.waitingSessionId}</td><td class="mono blocker">{item.blockingSessionId ?? "—"}</td><td class="mono">{item.object ?? "—"}</td><td>{item.lockType ?? "—"}</td><td>{item.lockMode ?? "—"}</td><td>{item.waitSeconds ?? "—"}</td><td class="statement">{item.statement ?? "—"}</td></tr>{:else}<tr><td colspan="7" class="table-empty">No lock waits currently visible.</td></tr>{/each}</tbody></table></div>
      {:else if tab === "variables" || tab === "status"}
        {@const items = tab === "variables" ? variables : status}
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody>{#each items as item}<tr><td class="mono name">{item.name}</td><td class="mono">{item.value}</td></tr>{:else}<tr><td colspan="2" class="table-empty">No values loaded.</td></tr>{/each}</tbody></table></div>
      {:else if tab === "security"}
        <div class="split">
          <div class="stack">
            <h3>Accounts</h3>
            <div class="table-wrap compact"><table><thead><tr><th>Account</th><th>Kind</th><th>Locked</th><th>Password expired</th></tr></thead><tbody>{#each accounts as item}<tr><td class="mono">{item.grantee}</td><td>{item.kind}</td><td>{item.accountLocked ? "Yes" : "No"}</td><td>{item.passwordExpired ? "Yes" : "No"}</td></tr>{/each}</tbody></table></div>
            <h3>Role memberships</h3>
            <div class="table-wrap compact"><table><thead><tr><th>Grantee</th><th>Role</th><th>Admin</th><th>Default</th></tr></thead><tbody>{#each roles as item}<tr><td class="mono">{item.grantee}</td><td class="mono">{item.role}</td><td>{item.adminOption ? "Yes" : "No"}</td><td>{item.defaultRole ? "Yes" : "No"}</td></tr>{:else}<tr><td colspan="4" class="table-empty">No role memberships visible.</td></tr>{/each}</tbody></table></div>
          </div>
          <div class="stack form-card">
            <h3>Guarded security change</h3>
            <label><span>Operation</span><select bind:value={securityKind} onchange={() => { securityPreview = undefined; }}><option value="grant-privilege">Grant privilege</option><option value="revoke-privilege">Revoke privilege</option><option value="grant-role">Grant role</option><option value="revoke-role">Revoke role</option></select></label>
            <label><span>Grantee</span><select bind:value={grantee}>{#each accounts as item}<option value={item.grantee}>{item.grantee}</option>{/each}</select></label>
            {#if isRoleChange}
              <label><span>Role</span><select bind:value={role}>{#each roleAccounts as item}<option value={item.grantee}>{item.grantee}</option>{/each}</select></label>
            {:else}
              <label><span>Privilege</span><select bind:value={privilege}>{#each privileges as item}<option value={item}>{item}</option>{/each}</select></label>
              <label><span>Scope</span><select bind:value={scope}><option value="global">Global (*.*)</option><option value="schema">Schema</option><option value="table">Table</option></select></label>
              {#if scope !== "global"}<label><span>Database</span><input bind:value={securityCatalog} placeholder="database" /></label>{/if}
              {#if scope === "table"}<label><span>Table</span><input bind:value={securityTable} placeholder="table" /></label>{/if}
            {/if}
            {#if securityKind === "grant-privilege" || securityKind === "grant-role"}<label class="check"><input type="checkbox" bind:checked={grantOption} /><span>{isRoleChange ? "WITH ADMIN OPTION" : "WITH GRANT OPTION"}</span></label>{/if}
            <button class="secondary" type="button" onclick={() => void previewSecurity()} disabled={loading}>Preview change</button>
            {#if securityPreview}
              <div class="preview"><strong>{securityPreview.destructive ? "Destructive/restrictive change" : "Change preview"}</strong>{#each securityPreview.statements as statement}<code>{statement}</code>{/each}{#each securityPreview.warnings as warning}<p>{warning}</p>{/each}</div>
              <label><span>Type {securityPreview.confirmation}</span><input bind:value={securityConfirmation} /></label>
              <button class="danger" type="button" onclick={() => void applySecurity()} disabled={loading || securityConfirmation !== securityPreview.confirmation}>Apply security change</button>
            {/if}
            <h3>Effective privilege rows</h3><div class="grant-list">{#each grants.slice(0,100) as item}<div><code>{item.grantee}</code><span>{item.privilege} · {item.scope}{item.catalog ? ` · ${item.catalog}` : ""}{item.table ? `.${item.table}` : ""}</span></div>{/each}</div>
          </div>
        </div>
      {:else if tab === "storage"}
        <div class="table-wrap"><table><thead><tr><th>Database</th><th>Tables</th><th>Estimated rows</th><th>Data</th><th>Indexes</th><th>Total</th></tr></thead><tbody>{#each storage as item}<tr><td class="mono name">{item.catalog}</td><td class="numeric">{item.tables}</td><td class="numeric">{item.estimatedRows}</td><td>{bytes(item.dataBytes)}</td><td>{bytes(item.indexBytes)}</td><td><strong>{bytes(item.totalBytes)}</strong></td></tr>{:else}<tr><td colspan="6" class="table-empty">No storage metadata visible.</td></tr>{/each}</tbody></table></div>
      {:else if tab === "data"}
        <div class="data-grid">
          <div class="form-card stack"><h3>Source</h3><label><span>Database</span><input bind:value={sourceCatalog} placeholder="database" /></label><label><span>Table</span><input bind:value={sourceTable} placeholder="table" /></label><label><span>Maximum rows</span><input type="number" min="1" max="100000" bind:value={rowLimit} /></label><button class="secondary" type="button" onclick={() => void exportTable()} disabled={loading}>Export JSON…</button></div>
          <div class="form-card stack"><h3>Target</h3><label><span>Database</span><input bind:value={targetCatalog} placeholder="database (optional for import)" /></label><label><span>Table</span><input bind:value={targetTable} placeholder="table (optional for import)" /></label><label class="check"><input type="checkbox" bind:checked={truncateTarget} /><span>Truncate target first</span></label><button class="secondary" type="button" onclick={() => void importTable()} disabled={loading}>Import JSON…</button></div>
          <div class="form-card stack wide"><h3>Compare / Transfer</h3><div class="action-row"><button class="secondary" type="button" onclick={() => void compareTables()} disabled={loading}>Compare tables</button><label class="inline"><span>Confirmation</span><input bind:value={transferConfirmation} placeholder="TRANSFER DATA" /></label><button class="danger" type="button" onclick={() => void transferTable()} disabled={loading || transferConfirmation !== "TRANSFER DATA"}>Transfer rows</button></div>{#if compareResult}<div class="compare"><strong>{compareResult.leftCount} → {compareResult.rightCount} rows ({compareResult.rowCountDelta >= 0 ? "+" : ""}{compareResult.rowCountDelta})</strong><p>Matching columns: {compareResult.matchingColumns.join(", ") || "none"}</p><p>Source only: {compareResult.leftOnlyColumns.join(", ") || "none"}</p><p>Target only: {compareResult.rightOnlyColumns.join(", ") || "none"}</p></div>{/if}</div>
        </div>
      {:else if tab === "backup"}
        <div class="hooks">{#each backupHooks as hook}<article class:available={hook.available}><div><strong>{hook.label}</strong><span>{hook.id}</span></div><p>{hook.description}</p><em>{hook.available ? "Available" : "Not configured"}</em></article>{:else}<div class="table-empty">No backup hooks advertised by this provider.</div>{/each}</div>
      {/if}
    </div>
  {/if}
</section>

<style>
  .admin-shell{padding:16px 22px 24px;display:grid;gap:14px;min-height:0}.toolbar{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.toolbar label{display:grid;gap:5px;min-width:220px}.toolbar label.filter{flex:1;min-width:260px}label span,.toolbar span{color:#748aa4;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}input,select{height:36px;border:1px solid #263b54;border-radius:7px;padding:0 10px;background:#0c1929;color:#dce8f6;outline:none}input:focus,select:focus{border-color:#467fc8}button{height:36px;border-radius:7px;padding:0 13px;cursor:pointer}.primary{border:1px solid #3d81de;background:#3478d4;color:#fff}.secondary{border:1px solid #2a4059;background:#101f31;color:#9fb2c9}.danger{border:1px solid #7d3542;background:#431a24;color:#ffc1ca}button:disabled{opacity:.5;cursor:default}.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.summary-grid article{border:1px solid #1e3044;border-radius:9px;padding:13px 14px;background:#0c1827}.summary-grid article.attention{border-color:#76424a;background:#1b151e}.summary-grid span,.summary-grid small{display:block;color:#71869f;font-size:10px}.summary-grid strong{display:block;margin:4px 0;color:#f1f6fc;font-size:23px}.summary-grid .time-value{font-size:17px;line-height:28px}.panel{min-height:420px;border:1px solid #1e3044;border-radius:10px;overflow:hidden;background:#0b1726}.tabs{display:flex;gap:4px;padding:9px 10px;border-bottom:1px solid #1e3044;background:#0e1b2b;overflow:auto}.tabs button{border:0;background:transparent;color:#8297af;white-space:nowrap}.tabs button.active{background:#182b42;color:#e5eef9}.message{margin:12px;border-radius:7px;padding:10px 12px;font-size:12px}.error{border:1px solid #6b3240;background:#2a151d;color:#ef9ead}.success{border:1px solid #285b49;background:#10251d;color:#80d5aa}.table-wrap{overflow:auto;max-height:560px}.table-wrap.compact{max-height:230px}table{width:100%;border-collapse:collapse;font-size:11px}th{position:sticky;top:0;z-index:1;padding:9px 10px;border-bottom:1px solid #24364b;background:#101d2e;color:#7188a3;text-align:left;font-size:9px;letter-spacing:.08em;text-transform:uppercase}td{padding:9px 10px;border-bottom:1px solid #16283a;color:#b8c8da;vertical-align:top}tr:hover td{background:#0e1d2f}.mono,code{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace}.numeric{text-align:right}.statement{max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.blocker{color:#ed9bad}.name{color:#8eb6eb}.table-empty{padding:36px;text-align:center;color:#60758e}.empty{display:grid;place-items:center;gap:5px;min-height:360px;border:1px dashed #2b4058;border-radius:10px;background:#0a1624;color:#d8e5f3}.empty span{color:#71869f;font-size:12px}.split{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(340px,.85fr);gap:14px;padding:14px}.stack{display:grid;gap:10px;align-content:start}.stack h3,.form-card h3{margin:4px 0;color:#dbe8f7;font-size:13px}.form-card{border:1px solid #20354d;border-radius:9px;padding:13px;background:#0d1a2a}.form-card label{display:grid;gap:5px}.check{display:flex!important;gap:8px;align-items:center}.check input{width:16px;height:16px}.preview{display:grid;gap:7px;border:1px solid #354963;border-radius:7px;padding:10px;background:#091522}.preview code{padding:8px;border-radius:5px;background:#050d17;color:#a9c6ed;white-space:pre-wrap}.preview p{margin:0;color:#d6a3ab;font-size:11px}.grant-list{max-height:180px;overflow:auto;display:grid;gap:5px}.grant-list div{display:grid;gap:2px;border-bottom:1px solid #1c2e42;padding:5px 0}.grant-list code{color:#8fb8eb;font-size:10px}.grant-list span{color:#7e93aa;font-size:10px}.data-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:14px}.data-grid .wide{grid-column:1/-1}.action-row{display:flex;gap:10px;align-items:end;flex-wrap:wrap}.inline{display:grid;gap:4px;min-width:240px;flex:1}.compare{border:1px solid #2a4058;border-radius:7px;padding:10px;color:#9eb3ca}.compare p{margin:5px 0;font-size:11px}.hooks{display:grid;gap:10px;padding:14px}.hooks article{display:grid;grid-template-columns:180px 1fr auto;gap:16px;align-items:center;border:1px solid #2a3544;border-radius:8px;padding:13px;background:#0d1928}.hooks article.available{border-color:#285846}.hooks strong,.hooks span{display:block}.hooks span{margin-top:3px;color:#647992;font-size:10px}.hooks p{margin:0;color:#8da0b6;font-size:11px}.hooks em{font-style:normal;color:#d69aa4;font-size:10px}.hooks article.available em{color:#77cba0}@media(max-width:1200px){.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.split,.data-grid{grid-template-columns:1fr}.data-grid .wide{grid-column:auto}}
</style>

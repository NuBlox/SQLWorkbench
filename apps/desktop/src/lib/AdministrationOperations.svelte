<script lang="ts">
  import type {
    AdministrationCompareResult,
    AdministrationSecurityPreparedPreview,
    AdministrationTransferPreparedPreview,
    DatabaseRoleMembership,
    DatabaseSecurityChange,
    DatabaseSecurityPrincipal,
    DatabaseSecurityPrivilege,
    DatabaseStorageEntry,
    OpenConnectionInfo,
  } from "$lib/desktop-api";

  export let connectionId: string;
  export let connections: readonly OpenConnectionInfo[] = [];

  type Section = "security" | "storage" | "data" | "compare" | "backup";
  let section: Section = "security";
  let busy = false;
  let message = "";
  let error = "";

  let principals: readonly DatabaseSecurityPrincipal[] = [];
  let privileges: readonly DatabaseSecurityPrivilege[] = [];
  let roles: readonly DatabaseRoleMembership[] = [];
  let selectedGrantee = "";
  let securityAction: DatabaseSecurityChange["kind"] = "grant-privileges";
  let securityRole = "reader@%";
  let securityPrivileges = "SELECT";
  let securityScope: "global" | "schema" | "table" = "schema";
  let securityCatalog = "";
  let securityTable = "";
  let securityPreview: AdministrationSecurityPreparedPreview | undefined;
  let securityConfirmation = "";

  let storage: readonly DatabaseStorageEntry[] = [];
  let catalog = "";
  let table = "";
  let rowLimit = 1000;

  let targetConnectionId = "";
  let targetCatalog = "";
  let targetTable = "";
  let compareResult: AdministrationCompareResult | undefined;
  let transferPreview: AdministrationTransferPreparedPreview | undefined;
  let transferConfirmation = "";

  let backupCatalog = "";
  let restoreConfirmation = "";

  $: targetConnections = connections.filter((item) => item.id !== connectionId);
  $: if (!targetConnections.some((item) => item.id === targetConnectionId)) targetConnectionId = targetConnections[0]?.id ?? connectionId;

  async function switchSection(next: Section): Promise<void> {
    section = next;
    clearNotice();
    if (next === "security" && principals.length === 0) await loadSecurity();
    if (next === "storage" && storage.length === 0) await loadStorage();
  }

  async function loadSecurity(): Promise<void> {
    await run(async () => {
      [principals, privileges, roles] = await Promise.all([
        window.nublox.administration.principals(connectionId),
        window.nublox.administration.privileges(connectionId),
        window.nublox.administration.roles(connectionId),
      ]);
      if (!selectedGrantee) selectedGrantee = principals[0]?.grantee ?? "";
      message = `Loaded ${principals.length} principals, ${roles.length} role memberships and ${privileges.length} privileges.`;
    });
  }

  function securityChange(): DatabaseSecurityChange {
    if (securityAction === "create-role" || securityAction === "drop-role") return { kind: securityAction, role: securityRole };
    if (securityAction === "grant-role") return { kind: securityAction, role: securityRole, grantee: selectedGrantee };
    if (securityAction === "revoke-role") return { kind: securityAction, role: securityRole, grantee: selectedGrantee };
    const values = securityPrivileges.split(",").map((item) => item.trim()).filter(Boolean);
    return {
      kind: securityAction,
      grantee: selectedGrantee,
      privileges: values,
      scope: securityScope,
      ...(securityScope !== "global" ? { catalog: securityCatalog } : {}),
      ...(securityScope === "table" ? { table: securityTable } : {}),
    };
  }

  async function previewSecurityChange(): Promise<void> {
    await run(async () => {
      securityPreview = await window.nublox.administration.previewSecurity({ connectionId, change: securityChange() });
      securityConfirmation = "";
      message = "Security change preview generated. Review the exact SQL before applying.";
    });
  }

  async function applySecurityChange(): Promise<void> {
    if (!securityPreview) return;
    await run(async () => {
      await window.nublox.administration.executeSecurity({ connectionId, change: securityChange(), fingerprint: securityPreview.guard.fingerprint, confirmation: securityConfirmation });
      securityPreview = undefined;
      securityConfirmation = "";
      await loadSecurity();
      message = "Security change applied successfully.";
    });
  }

  async function loadStorage(): Promise<void> {
    await run(async () => { storage = await window.nublox.administration.storage(connectionId); message = `Loaded ${storage.length} table storage records.`; });
  }

  async function exportData(format: "json" | "csv"): Promise<void> {
    await run(async () => {
      const result = await window.nublox.administration.exportData({ connectionId, catalog, table, limit: rowLimit, format });
      message = result.canceled ? "Export canceled." : `Exported ${result.rowsRead} rows to ${result.path}.`;
    });
  }

  async function importData(): Promise<void> {
    await run(async () => {
      const result = await window.nublox.administration.importData({ connectionId, catalog, table, limit: rowLimit });
      message = result.canceled ? "Import canceled." : `Imported ${result.rowsWritten ?? 0} of ${result.rowsRead} rows from ${result.path}.`;
    });
  }

  function compareRequest() {
    return { leftConnectionId: connectionId, leftCatalog: catalog, leftTable: table, rightConnectionId: targetConnectionId, rightCatalog: targetCatalog, rightTable: targetTable, limit: rowLimit };
  }

  async function compareData(): Promise<void> {
    await run(async () => { compareResult = await window.nublox.administration.compareData(compareRequest()); message = "Data comparison complete."; });
  }

  async function previewTransfer(): Promise<void> {
    await run(async () => { transferPreview = await window.nublox.administration.previewTransfer(compareRequest()); transferConfirmation = ""; message = "Transfer preview generated."; });
  }

  async function executeTransfer(): Promise<void> {
    if (!transferPreview) return;
    await run(async () => {
      const result = await window.nublox.administration.executeTransfer({ ...compareRequest(), fingerprint: transferPreview.guard.fingerprint, confirmation: transferConfirmation });
      transferPreview = undefined;
      transferConfirmation = "";
      message = `Transferred ${result.rowsWritten} of ${result.sourceRows} source rows.`;
    });
  }

  async function backup(): Promise<void> {
    await run(async () => { const result = await window.nublox.administration.backup({ connectionId, catalog: backupCatalog }); message = result.canceled ? "Backup canceled." : result.exitCode === 0 ? `Backup written to ${result.path}.` : `Backup command exited with code ${result.exitCode}: ${result.stderr ?? "unknown error"}`; });
  }

  async function restore(): Promise<void> {
    await run(async () => { const result = await window.nublox.administration.restore({ connectionId, catalog: backupCatalog, confirmation: restoreConfirmation }); message = result.canceled ? "Restore canceled." : result.exitCode === 0 ? `Restore completed from ${result.path}.` : `Restore command exited with code ${result.exitCode}: ${result.stderr ?? "unknown error"}`; });
  }

  async function run(work: () => Promise<void>): Promise<void> {
    busy = true; clearNotice();
    try { await work(); } catch (caught) { error = caught instanceof Error ? caught.message : String(caught); } finally { busy = false; }
  }
  function clearNotice(): void { message = ""; error = ""; }
  function bytes(value: number): string { if (value < 1024) return `${value} B`; if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`; if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`; return `${(value / 1024 ** 3).toFixed(2)} GB`; }
</script>

<div class="operations">
  <div class="operation-tabs">
    <button class:active={section === "security"} onclick={() => void switchSection("security")}>Users / Roles / Privileges</button>
    <button class:active={section === "storage"} onclick={() => void switchSection("storage")}>Storage</button>
    <button class:active={section === "data"} onclick={() => void switchSection("data")}>Import / Export</button>
    <button class:active={section === "compare"} onclick={() => void switchSection("compare")}>Compare / Transfer</button>
    <button class:active={section === "backup"} onclick={() => void switchSection("backup")}>Backup / Restore</button>
  </div>

  {#if error}<div class="notice error">{error}</div>{/if}
  {#if message}<div class="notice success">{message}</div>{/if}

  {#if section === "security"}
    <div class="actions"><button class="secondary" disabled={busy} onclick={() => void loadSecurity()}>Refresh security</button></div>
    <div class="two-col">
      <div class="card table-card">
        <h3>Principals</h3>
        <table><thead><tr><th>Account</th><th>Kind</th><th>Locked</th><th>Plugin</th></tr></thead><tbody>{#each principals as item}<tr class:selected={selectedGrantee === item.grantee} onclick={() => selectedGrantee = item.grantee}><td class="mono">{item.grantee}</td><td>{item.kind}</td><td>{item.accountLocked ? "yes" : "no"}</td><td>{item.authenticationPlugin ?? "—"}</td></tr>{:else}<tr><td colspan="4" class="empty-row">No visible principals.</td></tr>{/each}</tbody></table>
      </div>
      <div class="card form-card">
        <h3>Guarded security change</h3>
        <label>Action<select bind:value={securityAction}><option value="grant-privileges">Grant privileges</option><option value="revoke-privileges">Revoke privileges</option><option value="create-role">Create role</option><option value="drop-role">Drop role</option><option value="grant-role">Grant role</option><option value="revoke-role">Revoke role</option></select></label>
        {#if securityAction !== "create-role" && securityAction !== "drop-role"}<label>Grantee<select bind:value={selectedGrantee}>{#each principals as item}<option value={item.grantee}>{item.grantee}</option>{/each}</select></label>{/if}
        {#if securityAction.includes("role")}<label>Role<input bind:value={securityRole} placeholder="reader@%" /></label>{/if}
        {#if securityAction.includes("privileges")}
          <label>Privileges<input bind:value={securityPrivileges} placeholder="SELECT, INSERT, UPDATE" /></label>
          <label>Scope<select bind:value={securityScope}><option value="global">Global</option><option value="schema">Schema</option><option value="table">Table</option></select></label>
          {#if securityScope !== "global"}<label>Database<input bind:value={securityCatalog} /></label>{/if}
          {#if securityScope === "table"}<label>Table<input bind:value={securityTable} /></label>{/if}
        {/if}
        <button class="primary" disabled={busy} onclick={() => void previewSecurityChange()}>Preview security SQL</button>
        {#if securityPreview}
          <pre>{securityPreview.preview.statements.join("\n")}</pre>
          {#each securityPreview.preview.warnings as warning}<p class="warning">{warning}</p>{/each}
          <label>Confirmation<input bind:value={securityConfirmation} placeholder={securityPreview.guard.confirmationPhrase} /></label>
          <button class="danger" disabled={busy || securityConfirmation !== securityPreview.guard.confirmationPhrase} onclick={() => void applySecurityChange()}>Apply security change</button>
        {/if}
      </div>
    </div>
    <div class="two-col compact">
      <div class="card table-card"><h3>Role memberships</h3><table><thead><tr><th>Grantee</th><th>Role</th><th>Default</th></tr></thead><tbody>{#each roles as item}<tr><td class="mono">{item.grantee}</td><td class="mono">{item.role}</td><td>{item.defaultRole ? "yes" : "no"}</td></tr>{:else}<tr><td colspan="3" class="empty-row">No role memberships.</td></tr>{/each}</tbody></table></div>
      <div class="card table-card"><h3>Privileges</h3><table><thead><tr><th>Grantee</th><th>Privilege</th><th>Scope</th><th>Object</th></tr></thead><tbody>{#each privileges.slice(0, 250) as item}<tr><td class="mono">{item.grantee}</td><td>{item.privilege}</td><td>{item.scope}</td><td class="mono">{item.catalog ?? "*"}{item.table ? `.${item.table}` : ""}</td></tr>{:else}<tr><td colspan="4" class="empty-row">No privileges.</td></tr>{/each}</tbody></table></div>
    </div>
  {:else if section === "storage"}
    <div class="actions"><button class="secondary" disabled={busy} onclick={() => void loadStorage()}>Refresh storage</button></div>
    <div class="card table-card"><table><thead><tr><th>Database</th><th>Table</th><th>Engine</th><th>Rows</th><th>Data</th><th>Indexes</th><th>Free</th><th>Total</th></tr></thead><tbody>{#each storage as item}<tr><td>{item.catalog}</td><td class="mono">{item.table ?? "—"}</td><td>{item.engine ?? "—"}</td><td class="num">{item.estimatedRows ?? "—"}</td><td class="num">{bytes(item.dataBytes)}</td><td class="num">{bytes(item.indexBytes)}</td><td class="num">{bytes(item.freeBytes)}</td><td class="num">{bytes(item.totalBytes)}</td></tr>{:else}<tr><td colspan="8" class="empty-row">No storage metadata loaded.</td></tr>{/each}</tbody></table></div>
  {:else if section === "data"}
    <div class="card form-card wide"><h3>Bounded table import / export</h3><div class="field-grid"><label>Database<input bind:value={catalog} /></label><label>Table<input bind:value={table} /></label><label>Maximum rows<input type="number" min="1" max="10000" bind:value={rowLimit} /></label></div><p>Exports are bounded to 10,000 rows. JSON imports must contain an array of objects with a consistent column set.</p><div class="actions"><button class="secondary" disabled={busy || !catalog || !table} onclick={() => void exportData("json")}>Export JSON</button><button class="secondary" disabled={busy || !catalog || !table} onclick={() => void exportData("csv")}>Export CSV</button><button class="primary" disabled={busy || !catalog || !table} onclick={() => void importData()}>Import JSON</button></div></div>
  {:else if section === "compare"}
    <div class="card form-card wide"><h3>Compare and transfer data</h3><div class="field-grid"><label>Source database<input bind:value={catalog} /></label><label>Source table<input bind:value={table} /></label><label>Target connection<select bind:value={targetConnectionId}>{#each connections as item}<option value={item.id}>{item.id}</option>{/each}</select></label><label>Target database<input bind:value={targetCatalog} /></label><label>Target table<input bind:value={targetTable} /></label><label>Maximum rows<input type="number" min="1" max="10000" bind:value={rowLimit} /></label></div><div class="actions"><button class="secondary" disabled={busy || !catalog || !table || !targetCatalog || !targetTable} onclick={() => void compareData()}>Compare</button><button class="primary" disabled={busy || !catalog || !table || !targetCatalog || !targetTable} onclick={() => void previewTransfer()}>Preview transfer</button></div>{#if compareResult}<div class="metrics"><span>Left <strong>{compareResult.leftRows}</strong></span><span>Right <strong>{compareResult.rightRows}</strong></span><span>Matching <strong>{compareResult.matchingRows}</strong></span><span>Differences <strong>{compareResult.differentRows}</strong></span><span>Columns <strong>{compareResult.columnsMatch ? "match" : "differ"}</strong></span></div>{/if}{#if transferPreview}<p>Source rows to append: <strong>{transferPreview.sourceRows}</strong>. Existing target rows sampled: <strong>{transferPreview.targetRows}</strong>.</p><label>Confirmation<input bind:value={transferConfirmation} placeholder={transferPreview.guard.confirmationPhrase} /></label><button class="danger" disabled={busy || transferConfirmation !== transferPreview.guard.confirmationPhrase} onclick={() => void executeTransfer()}>Transfer rows</button>{/if}</div>
  {:else}
    <div class="card form-card wide"><h3>MySQL logical backup / restore hooks</h3><label>Database<input bind:value={backupCatalog} /></label><p>Backup uses <span class="mono">mysqldump</span>; restore uses the <span class="mono">mysql</span> client. The executable must be installed on PATH. Connection passwords are passed only to the child process environment and are never placed in command arguments.</p><div class="actions"><button class="primary" disabled={busy || !backupCatalog} onclick={() => void backup()}>Create backup…</button></div><div class="restore"><label>Restore confirmation<input bind:value={restoreConfirmation} placeholder="RESTORE DATABASE" /></label><button class="danger" disabled={busy || !backupCatalog || restoreConfirmation !== "RESTORE DATABASE"} onclick={() => void restore()}>Restore SQL backup…</button></div></div>
  {/if}
</div>

<style>
  .operations{display:grid;gap:12px;padding:12px}.operation-tabs{display:flex;gap:5px;flex-wrap:wrap}.operation-tabs button,.actions button,.form-card button{border:1px solid #2a4059;border-radius:6px;padding:7px 10px;background:#101f31;color:#9fb2c9;cursor:pointer}.operation-tabs button.active{border-color:#3a6fae;background:#172c45;color:#e8f2ff}.two-col{display:grid;grid-template-columns:1.05fr .95fr;gap:12px}.two-col.compact{grid-template-columns:1fr 1fr}.card{border:1px solid #1e3044;border-radius:9px;background:#0c1827;padding:12px}.card h3{margin:0 0 10px;color:#e3edf8;font-size:13px}.table-card{padding:0;overflow:auto;max-height:360px}.table-card h3{padding:12px 12px 0}.form-card{display:grid;gap:9px}.form-card.wide{max-width:1050px}.form-card label{display:grid;gap:4px;color:#71869f;font-size:10px;text-transform:uppercase;letter-spacing:.07em}.form-card input,.form-card select{height:34px;border:1px solid #263b54;border-radius:6px;padding:0 9px;background:#0a1624;color:#dce8f6}.form-card pre{max-height:150px;overflow:auto;padding:9px;border:1px solid #20344a;border-radius:6px;background:#08121e;color:#9fc1e9;font-size:10px}.form-card p{margin:0;color:#7f93aa;font-size:11px}.warning{color:#e7ac71!important}.actions{display:flex;gap:8px;flex-wrap:wrap}.primary{border-color:#3d81de!important;background:#3478d4!important;color:#fff!important}.danger{border-color:#7b3c48!important;background:#3a1720!important;color:#efa8b4!important}.secondary{background:#101f31!important}.actions button:disabled,.form-card button:disabled{opacity:.45;cursor:default}.notice{padding:9px 11px;border-radius:6px;font-size:11px}.notice.error{border:1px solid #6b3240;background:#2a151d;color:#ef9ead}.notice.success{border:1px solid #28583f;background:#10251b;color:#8ed0aa}.field-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.metrics{display:flex;gap:8px;flex-wrap:wrap}.metrics span{border:1px solid #243a52;border-radius:6px;padding:7px 9px;color:#7890aa;font-size:10px}.metrics strong{color:#e6eff9}.restore{display:grid;gap:8px;margin-top:5px;padding-top:10px;border-top:1px solid #1d3044}table{width:100%;border-collapse:collapse;font-size:10px}th{position:sticky;top:0;padding:8px;background:#101d2e;color:#7188a3;text-align:left;font-size:8px;text-transform:uppercase;letter-spacing:.08em}td{padding:8px;border-top:1px solid #16283a;color:#b8c8da}.selected td{background:#142840}.mono{font-family:"SFMono-Regular",Consolas,"Liberation Mono",monospace}.num{text-align:right}.empty-row{text-align:center;padding:24px;color:#60758e}@media(max-width:1100px){.two-col,.two-col.compact{grid-template-columns:1fr}.field-grid{grid-template-columns:1fr 1fr}}
</style>

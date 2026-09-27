<script lang="ts">
  import { onMount } from "svelte";
  import type { ConnectionProfile } from "@nublox/workbench-connection-profiles";
  import type {
    ExplorerEvent,
    ExplorerNamespace,
    ExplorerPrincipal,
    ExplorerPrivilege,
    ExplorerRelation,
    ExplorerRelationDetails,
    ExplorerRoleGrant,
    ExplorerRoutine,
    ExplorerSearchResult,
    ExplorerTrigger,
    OpenConnectionInfo,
  } from "$lib/desktop-api";

  type DetailSelection =
    | { kind: "relation"; value: ExplorerRelationDetails }
    | { kind: "routine"; value: ExplorerRoutine }
    | { kind: "trigger"; value: ExplorerTrigger }
    | { kind: "event"; value: ExplorerEvent }
    | { kind: "principal"; value: ExplorerPrincipal }
    | { kind: "search"; value: ExplorerSearchResult };

  let profiles: readonly ConnectionProfile[] = [];
  let openConnections: readonly OpenConnectionInfo[] = [];
  let activeConnectionId = "";
  let includeSystem = false;
  let namespaces: readonly ExplorerNamespace[] = [];
  let expandedNamespaces = new Set<string>();
  let relationsByNamespace = new Map<string, readonly ExplorerRelation[]>();
  let routinesByNamespace = new Map<string, readonly ExplorerRoutine[]>();
  let triggersByNamespace = new Map<string, readonly ExplorerTrigger[]>();
  let eventsByNamespace = new Map<string, readonly ExplorerEvent[]>();
  let loadingKeys = new Set<string>();
  let principals: readonly ExplorerPrincipal[] = [];
  let roleGrants: readonly ExplorerRoleGrant[] = [];
  let privileges: readonly ExplorerPrivilege[] = [];
  let securityLoaded = false;
  let searchTerm = "";
  let searchResults: readonly ExplorerSearchResult[] = [];
  let searching = false;
  let selected: DetailSelection | undefined;
  let detailTab: "columns" | "indexes" | "foreignKeys" | "definition" | "privileges" = "columns";
  let notice = "Select an open connection to browse metadata.";
  let errorMessage = "";

  $: activeProfile = profiles.find((profile) => profile.id === activeConnectionId);
  $: activeConnection = openConnections.find((connection) => connection.profileId === activeConnectionId);

  onMount(() => { void refreshConnections(); });

  async function refreshConnections(): Promise<void> {
    try {
      [profiles, openConnections] = await Promise.all([window.nublox.profiles.list(), window.nublox.connections.list()]);
      if (!openConnections.some((item) => item.profileId === activeConnectionId)) activeConnectionId = openConnections[0]?.profileId ?? "";
      if (activeConnectionId) await loadNamespaces();
    } catch (error) { setError(error); }
  }

  async function changeConnection(): Promise<void> {
    clearCaches();
    if (activeConnectionId) await loadNamespaces();
  }

  async function loadNamespaces(): Promise<void> {
    if (!activeConnectionId) { namespaces = []; return; }
    errorMessage = "";
    setLoading("namespaces", true);
    try {
      namespaces = await window.nublox.explorer.namespaces({ connectionId: activeConnectionId, includeSystem });
      notice = `Loaded ${namespaces.length} database namespace${namespaces.length === 1 ? "" : "s"}.`;
    } catch (error) { setError(error); }
    finally { setLoading("namespaces", false); }
  }

  async function toggleNamespace(namespace: ExplorerNamespace): Promise<void> {
    const next = new Set(expandedNamespaces);
    if (next.has(namespace.key)) { next.delete(namespace.key); expandedNamespaces = next; return; }
    next.add(namespace.key); expandedNamespaces = next;
    if (!relationsByNamespace.has(namespace.key)) await loadRelations(namespace);
  }

  async function loadRelations(namespace: ExplorerNamespace, force = false): Promise<void> {
    if (!force && relationsByNamespace.has(namespace.key)) return;
    await loadNamespaceCollection(`relations:${namespace.key}`, async () => {
      const value = await window.nublox.explorer.relations(namespaceRequest(namespace));
      relationsByNamespace.set(namespace.key, value); relationsByNamespace = new Map(relationsByNamespace);
    });
  }

  async function loadRoutines(namespace: ExplorerNamespace, force = false): Promise<void> {
    if (!force && routinesByNamespace.has(namespace.key)) return;
    await loadNamespaceCollection(`routines:${namespace.key}`, async () => {
      const value = await window.nublox.explorer.routines(namespaceRequest(namespace));
      routinesByNamespace.set(namespace.key, value); routinesByNamespace = new Map(routinesByNamespace);
    });
  }

  async function loadTriggers(namespace: ExplorerNamespace, force = false): Promise<void> {
    if (!force && triggersByNamespace.has(namespace.key)) return;
    await loadNamespaceCollection(`triggers:${namespace.key}`, async () => {
      const value = await window.nublox.explorer.triggers(namespaceRequest(namespace));
      triggersByNamespace.set(namespace.key, value); triggersByNamespace = new Map(triggersByNamespace);
    });
  }

  async function loadEvents(namespace: ExplorerNamespace, force = false): Promise<void> {
    if (!force && eventsByNamespace.has(namespace.key)) return;
    await loadNamespaceCollection(`events:${namespace.key}`, async () => {
      const value = await window.nublox.explorer.events(namespaceRequest(namespace));
      eventsByNamespace.set(namespace.key, value); eventsByNamespace = new Map(eventsByNamespace);
    });
  }

  function namespaceRequest(namespace: ExplorerNamespace) {
    return {
      connectionId: activeConnectionId,
      ...(namespace.catalog ? { catalog: namespace.catalog } : {}),
      ...(namespace.schema ? { schema: namespace.schema } : {}),
      includeSystem,
    };
  }

  async function selectRelation(relation: ExplorerRelation): Promise<void> {
    setLoading(`detail:${relation.key}`, true);
    try {
      const value = await window.nublox.explorer.describe({
        connectionId: activeConnectionId,
        ...(relation.catalog ? { catalog: relation.catalog } : {}),
        ...(relation.schema ? { schema: relation.schema } : {}),
        name: relation.name,
        includeSystem,
      });
      selected = { kind: "relation", value };
      detailTab = "columns";
      notice = `Loaded ${qualified(relation.catalog, relation.schema, relation.name)}.`;
    } catch (error) { setError(error); }
    finally { setLoading(`detail:${relation.key}`, false); }
  }

  function selectRoutine(value: ExplorerRoutine): void { selected = { kind: "routine", value }; detailTab = "definition"; }
  function selectTrigger(value: ExplorerTrigger): void { selected = { kind: "trigger", value }; detailTab = "definition"; }
  function selectEvent(value: ExplorerEvent): void { selected = { kind: "event", value }; detailTab = "definition"; }

  async function loadSecurity(): Promise<void> {
    if (!activeConnectionId) return;
    setLoading("security", true);
    try {
      [principals, roleGrants] = await Promise.all([
        window.nublox.explorer.principals(activeConnectionId),
        window.nublox.explorer.roles(activeConnectionId),
      ]);
      securityLoaded = true;
      notice = `Loaded ${principals.length} visible principal${principals.length === 1 ? "" : "s"}.`;
    } catch (error) { setError(error); }
    finally { setLoading("security", false); }
  }

  async function selectPrincipal(principal: ExplorerPrincipal): Promise<void> {
    setLoading(`principal:${principal.grantee}`, true);
    try {
      privileges = await window.nublox.explorer.privileges({ connectionId: activeConnectionId, grantee: principal.grantee });
      selected = { kind: "principal", value: principal };
      detailTab = "privileges";
    } catch (error) { setError(error); }
    finally { setLoading(`principal:${principal.grantee}`, false); }
  }

  async function search(): Promise<void> {
    if (!activeConnectionId || !searchTerm.trim()) { searchResults = []; return; }
    searching = true; errorMessage = "";
    try {
      searchResults = await window.nublox.explorer.search({ connectionId: activeConnectionId, term: searchTerm.trim(), limit: 200 });
      notice = `Found ${searchResults.length} object${searchResults.length === 1 ? "" : "s"}.`;
    } catch (error) { setError(error); }
    finally { searching = false; }
  }

  async function selectSearchResult(result: ExplorerSearchResult): Promise<void> {
    if (result.kind === "table" || result.kind === "view") {
      await selectRelation({ key: result.key, ...(result.catalog ? { catalog: result.catalog } : {}), ...(result.schema ? { schema: result.schema } : {}), name: result.name, kind: result.kind });
      return;
    }
    selected = { kind: "search", value: result };
    detailTab = "definition";
  }

  async function refreshAll(): Promise<void> {
    clearCaches();
    await loadNamespaces();
  }

  function clearCaches(): void {
    namespaces = [];
    expandedNamespaces = new Set();
    relationsByNamespace = new Map();
    routinesByNamespace = new Map();
    triggersByNamespace = new Map();
    eventsByNamespace = new Map();
    principals = [];
    roleGrants = [];
    privileges = [];
    securityLoaded = false;
    searchResults = [];
    selected = undefined;
  }

  async function loadNamespaceCollection(key: string, action: () => Promise<void>): Promise<void> {
    setLoading(key, true); errorMessage = "";
    try { await action(); } catch (error) { setError(error); }
    finally { setLoading(key, false); }
  }

  function setLoading(key: string, value: boolean): void {
    const next = new Set(loadingKeys);
    if (value) next.add(key); else next.delete(key);
    loadingKeys = next;
  }
  function setError(error: unknown): void { errorMessage = error instanceof Error ? error.message : String(error); notice = "Explorer action failed."; }
  function qualified(catalog?: string, schema?: string, name?: string): string { return [catalog, schema, name].filter(Boolean).join("."); }
  function displayDefault(value: unknown): string { if (value === null || value === undefined) return "NULL"; if (typeof value === "string") return value; try { return JSON.stringify(value); } catch { return String(value); } }
  function principalRoles(grantee: string): readonly ExplorerRoleGrant[] { return roleGrants.filter((grant) => grant.grantee === grantee); }
</script>

<section class="explorer-layout">
  <aside class="panel tree-panel">
    <div class="connection-bar">
      <label><span>Connection</span><select bind:value={activeConnectionId} onchange={changeConnection}><option value="">Select an open connection</option>{#each openConnections as connection (connection.profileId)}{@const profile = profiles.find((item) => item.id === connection.profileId)}<option value={connection.profileId}>{profile?.name ?? connection.profileId}</option>{/each}</select></label>
      <button class="icon-button" type="button" title="Refresh explorer" disabled={!activeConnectionId} onclick={refreshAll}>↻</button>
    </div>
    <label class="system-toggle"><input type="checkbox" bind:checked={includeSystem} onchange={refreshAll} disabled={!activeConnectionId} /> Show system databases</label>

    <form class="search-box" onsubmit={(event) => { event.preventDefault(); void search(); }}>
      <input bind:value={searchTerm} placeholder="Search database objects…" disabled={!activeConnectionId} />
      <button type="submit" disabled={!activeConnectionId || !searchTerm.trim() || searching}>{searching ? "…" : "Search"}</button>
    </form>

    <div class="tree-scroll">
      {#if searchResults.length > 0}
        <div class="tree-section"><div class="section-label">Search results</div>{#each searchResults as result (result.key)}<button class="object-row search-result" type="button" onclick={() => selectSearchResult(result)}><span class="object-icon">{result.kind === "table" ? "▦" : result.kind === "view" ? "◫" : "◇"}</span><span><strong>{result.name}</strong><small>{result.catalog ?? result.schema ?? "default"} · {result.kind}</small></span></button>{/each}</div>
      {/if}

      {#if !activeConnectionId}
        <div class="empty-state">Open a connection in the Connections workspace, then select it here.</div>
      {:else if loadingKeys.has("namespaces")}
        <div class="empty-state">Loading databases…</div>
      {:else}
        <div class="tree-section">
          <div class="section-label">Databases</div>
          {#each namespaces as namespace (namespace.key)}
            <div class="namespace-node">
              <button class="namespace-row" type="button" onclick={() => toggleNamespace(namespace)}>
                <span class="chevron">{expandedNamespaces.has(namespace.key) ? "⌄" : "›"}</span><span class="database-icon">◉</span><strong>{namespace.label}</strong>{#if namespace.system}<small>system</small>{/if}
              </button>
              {#if expandedNamespaces.has(namespace.key)}
                <div class="namespace-children">
                  <div class="group-block">
                    <button class="group-row" type="button" onclick={() => loadRelations(namespace, true)}><span>▦</span><strong>Tables & views</strong><small>{relationsByNamespace.get(namespace.key)?.length ?? ""}</small></button>
                    {#if loadingKeys.has(`relations:${namespace.key}`)}<div class="loading-row">Loading…</div>{:else}{#each relationsByNamespace.get(namespace.key) ?? [] as relation (relation.key)}<button class="object-row" type="button" onclick={() => selectRelation(relation)}><span class="object-icon">{relation.kind === "view" ? "◫" : "▦"}</span><span><strong>{relation.name}</strong><small>{relation.kind}{relation.estimatedRows !== undefined ? ` · ~${relation.estimatedRows} rows` : ""}</small></span></button>{/each}{/if}
                  </div>
                  <div class="group-block"><button class="group-row" type="button" onclick={() => loadRoutines(namespace)}><span>ƒ</span><strong>Procedures & functions</strong><small>{routinesByNamespace.get(namespace.key)?.length ?? ""}</small></button>{#if loadingKeys.has(`routines:${namespace.key}`)}<div class="loading-row">Loading…</div>{:else}{#each routinesByNamespace.get(namespace.key) ?? [] as routine (routine.key)}<button class="object-row" type="button" onclick={() => selectRoutine(routine)}><span class="object-icon">ƒ</span><span><strong>{routine.name}</strong><small>{routine.kind}</small></span></button>{/each}{/if}</div>
                  <div class="group-block"><button class="group-row" type="button" onclick={() => loadTriggers(namespace)}><span>⚡</span><strong>Triggers</strong><small>{triggersByNamespace.get(namespace.key)?.length ?? ""}</small></button>{#if loadingKeys.has(`triggers:${namespace.key}`)}<div class="loading-row">Loading…</div>{:else}{#each triggersByNamespace.get(namespace.key) ?? [] as trigger (trigger.key)}<button class="object-row" type="button" onclick={() => selectTrigger(trigger)}><span class="object-icon">⚡</span><span><strong>{trigger.name}</strong><small>{trigger.timing} {trigger.event} · {trigger.table}</small></span></button>{/each}{/if}</div>
                  <div class="group-block"><button class="group-row" type="button" onclick={() => loadEvents(namespace)}><span>◷</span><strong>Events</strong><small>{eventsByNamespace.get(namespace.key)?.length ?? ""}</small></button>{#if loadingKeys.has(`events:${namespace.key}`)}<div class="loading-row">Loading…</div>{:else}{#each eventsByNamespace.get(namespace.key) ?? [] as event (event.key)}<button class="object-row" type="button" onclick={() => selectEvent(event)}><span class="object-icon">◷</span><span><strong>{event.name}</strong><small>{event.status ?? event.scheduleType ?? "event"}</small></span></button>{/each}{/if}</div>
                </div>
              {/if}
            </div>
          {/each}
        </div>

        <div class="tree-section security-section">
          <button class="security-root" type="button" onclick={loadSecurity}><span>♙</span><strong>Users, roles & privileges</strong><small>{securityLoaded ? principals.length : "load"}</small></button>
          {#if loadingKeys.has("security")}<div class="loading-row">Loading security metadata…</div>{:else if securityLoaded}<div class="security-list">{#each principals as principal (principal.grantee)}<button class="object-row" type="button" onclick={() => selectPrincipal(principal)}><span class="object-icon">{principal.kind === "role" ? "♢" : "♙"}</span><span><strong>{principal.name}</strong><small>{principal.host ?? ""} · {principal.kind}</small></span></button>{/each}</div>{/if}
        </div>
      {/if}
    </div>
  </aside>

  <main class="panel detail-panel">
    {#if !selected}
      <div class="detail-empty"><div class="detail-glyph">◇</div><h2>Database Explorer</h2><p>Select a table, view, routine, trigger, event, user or role to inspect its live metadata.</p>{#if activeProfile}<small>{activeProfile.name} · {activeProfile.host}</small>{/if}</div>
    {:else if selected.kind === "relation"}
      {@const detail = selected.value}
      <div class="detail-heading"><div><p class="eyebrow">{detail.relation.kind}</p><h2>{qualified(detail.relation.catalog, detail.relation.schema, detail.relation.name)}</h2><p>{detail.relation.comment ?? detail.relation.engine ?? "Database relation"}</p></div><div class="detail-metrics"><span>{detail.columns.length} columns</span><span>{detail.indexes.length} indexes</span><span>{detail.foreignKeys.length} foreign keys</span></div></div>
      <div class="detail-tabs"><button class:active={detailTab === "columns"} onclick={() => (detailTab = "columns")}>Columns</button><button class:active={detailTab === "indexes"} onclick={() => (detailTab = "indexes")}>Indexes</button><button class:active={detailTab === "foreignKeys"} onclick={() => (detailTab = "foreignKeys")}>Foreign keys</button></div>
      <div class="detail-content">
        {#if detailTab === "columns"}<table><thead><tr><th>#</th><th>Name</th><th>Type</th><th>Nullable</th><th>Default</th><th>Attributes</th></tr></thead><tbody>{#each detail.columns as column}<tr><td>{column.ordinal}</td><td><strong>{column.name}</strong></td><td><code>{column.databaseType}</code></td><td>{column.nullable ? "YES" : "NO"}</td><td><code>{displayDefault(column.defaultValue)}</code></td><td>{[column.autoIncrement ? "auto increment" : "", column.generated ? "generated" : ""].filter(Boolean).join(", ") || "—"}</td></tr>{/each}</tbody></table>
        {:else if detailTab === "indexes"}<div class="card-list">{#each detail.indexes as index}<article><header><strong>{index.name}</strong><span>{index.primary ? "PRIMARY" : index.unique ? "UNIQUE" : index.type ?? "INDEX"}</span></header><p>{index.columns.map((column) => `${column.name}${column.direction ? ` ${column.direction.toUpperCase()}` : ""}`).join(", ")}</p></article>{/each}{#if detail.indexes.length === 0}<div class="empty-state">No indexes reported.</div>{/if}</div>
        {:else}<div class="card-list">{#each detail.foreignKeys as fk}<article><header><strong>{fk.name}</strong><span>{fk.updateRule ?? ""} / {fk.deleteRule ?? ""}</span></header><p>{fk.columns.join(", ")} → {qualified(fk.referencedCatalog, fk.referencedSchema, fk.referencedTable)} ({fk.referencedColumns.join(", ")})</p></article>{/each}{#if detail.foreignKeys.length === 0}<div class="empty-state">No foreign keys reported.</div>{/if}</div>{/if}
      </div>
    {:else if selected.kind === "principal"}
      {@const principal = selected.value}
      <div class="detail-heading"><div><p class="eyebrow">{principal.kind}</p><h2>{principal.name}{principal.host ? `@${principal.host}` : ""}</h2><p>{principal.grantee}</p></div></div>
      <div class="detail-tabs"><button class:active={detailTab === "privileges"} onclick={() => (detailTab = "privileges")}>Privileges</button><button class:active={detailTab === "definition"} onclick={() => (detailTab = "definition")}>Roles</button></div>
      <div class="detail-content">{#if detailTab === "privileges"}<table><thead><tr><th>Scope</th><th>Object</th><th>Privilege</th><th>Grantable</th></tr></thead><tbody>{#each privileges as privilege}<tr><td>{privilege.scope}</td><td>{qualified(privilege.catalog, privilege.schema, privilege.table)}{privilege.column ? `.${privilege.column}` : ""}</td><td><strong>{privilege.privilege}</strong></td><td>{privilege.grantable ? "YES" : "NO"}</td></tr>{/each}</tbody></table>{:else}<div class="card-list">{#each principalRoles(principal.grantee) as grant}<article><header><strong>{grant.role}</strong><span>{grant.defaultRole ? "default" : "assigned"}</span></header><p>{grant.grantable ? "Role may be granted onward." : "Not grantable."}</p></article>{/each}{#if principalRoles(principal.grantee).length === 0}<div class="empty-state">No visible role grants.</div>{/if}</div>{/if}</div>
    {:else}
      {@const item = selected.value}
      <div class="detail-heading"><div><p class="eyebrow">{selected.kind === "search" ? item.kind : selected.kind}</p><h2>{qualified(item.catalog, item.schema, item.name)}</h2>{#if "comment" in item && item.comment}<p>{item.comment}</p>{/if}</div></div>
      <div class="detail-content definition-view">
        {#if selected.kind === "routine"}<dl><dt>Kind</dt><dd>{item.kind}</dd>{#if item.dataType}<dt>Return type</dt><dd>{item.dataType}</dd>{/if}{#if item.securityType}<dt>Security</dt><dd>{item.securityType}</dd>{/if}{#if item.sqlDataAccess}<dt>SQL access</dt><dd>{item.sqlDataAccess}</dd>{/if}</dl><pre>{item.definition ?? "Definition is not visible to this database identity."}</pre>
        {:else if selected.kind === "trigger"}<dl><dt>Table</dt><dd>{item.table}</dd><dt>Timing</dt><dd>{item.timing}</dd><dt>Event</dt><dd>{item.event}</dd></dl><pre>{item.statement ?? "Statement is not visible."}</pre>
        {:else if selected.kind === "event"}<dl><dt>Status</dt><dd>{item.status ?? "—"}</dd><dt>Schedule</dt><dd>{item.scheduleType ?? "—"}</dd>{#if item.executeAt}<dt>Execute at</dt><dd>{item.executeAt}</dd>{/if}{#if item.intervalValue}<dt>Interval</dt><dd>{item.intervalValue} {item.intervalField ?? ""}</dd>{/if}</dl><pre>{item.definition ?? "Definition is not visible."}</pre>
        {:else}<p>Search result: {item.kind}. Open its database category for complete metadata.</p>{/if}
      </div>
    {/if}
  </main>
</section>
<footer class="activity-bar" class:error={Boolean(errorMessage)}><span class="activity-indicator"></span><span>{errorMessage || notice}</span>{#if activeConnection}<span class="connection-status">{activeConnection.providerId} · {activeConnection.latencyMs ?? "—"} ms</span>{/if}</footer>

<style>
  .explorer-layout{flex:1;min-height:0;display:grid;grid-template-columns:365px minmax(0,1fr);gap:16px;padding:20px 22px}.panel{min-width:0;min-height:0;overflow:hidden;border:1px solid #1e3044;border-radius:11px;background:rgba(13,25,41,.86)}.tree-panel{display:flex;flex-direction:column}.connection-bar{display:grid;grid-template-columns:1fr 36px;gap:8px;align-items:end;padding:13px 13px 7px}.connection-bar label span{display:block;margin-bottom:5px;color:#6f849d;font-size:9px;text-transform:uppercase}.connection-bar select,.search-box input{width:100%;border:1px solid #263a52;border-radius:7px;padding:8px 9px;background:#0b1726;color:#dce7f3;outline:none}.icon-button{height:34px;border:1px solid #304966;border-radius:7px;background:#14263b;color:#9db3cd;cursor:pointer}.system-toggle{display:flex;gap:7px;align-items:center;padding:3px 14px 10px;color:#6f849d;font-size:9px}.search-box{display:grid;grid-template-columns:1fr auto;gap:7px;padding:0 13px 12px;border-bottom:1px solid #1b2c3f}.search-box button{border:1px solid #304966;border-radius:7px;padding:0 10px;background:#14263b;color:#bfd0e3;font-size:9px}.tree-scroll{flex:1;overflow:auto;padding:8px}.section-label{padding:7px 8px;color:#526a85;font-size:8px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.namespace-row,.group-row,.object-row,.security-root{width:100%;border:0;background:transparent;color:inherit;text-align:left;cursor:pointer}.namespace-row{display:grid;grid-template-columns:14px 18px 1fr auto;gap:5px;align-items:center;padding:8px;border-radius:6px;color:#c6d6e8;font-size:10px}.namespace-row:hover,.group-row:hover,.object-row:hover,.security-root:hover{background:#12243a}.namespace-row small{color:#637993;font-size:8px}.chevron{color:#5f7997}.database-icon,.object-icon{color:#67a2ff}.namespace-children{margin-left:16px;border-left:1px solid #20334b;padding-left:7px}.group-block{margin:2px 0}.group-row{display:grid;grid-template-columns:18px 1fr auto;gap:5px;padding:6px 7px;border-radius:5px;color:#91a7bf;font-size:9px}.group-row small{color:#526b87}.object-row{display:grid;grid-template-columns:18px 1fr;gap:6px;padding:6px 8px;border-radius:5px}.object-row strong,.object-row small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.object-row strong{color:#c1d0e1;font-size:9px;font-weight:550}.object-row small{margin-top:2px;color:#5f7691;font-size:8px}.loading-row{padding:6px 26px;color:#5d7590;font-size:8px}.security-section{margin-top:12px;padding-top:8px;border-top:1px solid #1b2c3f}.security-root{display:grid;grid-template-columns:20px 1fr auto;gap:5px;padding:8px;border-radius:6px;color:#a9bbcf;font-size:9px}.security-list{padding-left:12px}.detail-panel{display:flex;flex-direction:column}.detail-empty{margin:auto;max-width:430px;padding:40px;text-align:center;color:#7489a2}.detail-glyph{margin-bottom:15px;color:#4f8eea;font-size:36px}.detail-empty h2{margin:0 0 8px;color:#dce8f5}.detail-empty p{font-size:11px;line-height:1.6}.detail-empty small{color:#536b85}.detail-heading{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:20px 22px;border-bottom:1px solid #1b2c3f}.detail-heading h2{margin:0 0 5px;color:#edf5fd;font-size:18px}.detail-heading p{margin:0;color:#7388a0;font-size:10px}.eyebrow{margin-bottom:5px!important;color:#5795f6!important;font-size:8px!important;font-weight:800;text-transform:uppercase;letter-spacing:.14em}.detail-metrics{display:flex;gap:7px;flex-wrap:wrap}.detail-metrics span{border:1px solid #28405a;border-radius:999px;padding:5px 8px;color:#7793b1;font-size:8px}.detail-tabs{display:flex;gap:2px;padding:9px 14px 0;border-bottom:1px solid #1b2c3f}.detail-tabs button{border:0;border-radius:6px 6px 0 0;padding:8px 11px;background:transparent;color:#7189a4;font-size:9px}.detail-tabs button.active{background:#162a41;color:#d5e3f2}.detail-content{flex:1;min-height:0;overflow:auto}.detail-content table{width:100%;border-collapse:collapse;font-size:9px}.detail-content th,.detail-content td{padding:8px 10px;border-bottom:1px solid #1a2a3c;text-align:left;vertical-align:top}.detail-content th{position:sticky;top:0;background:#102036;color:#7991ad;font-size:8px;text-transform:uppercase}.detail-content td{color:#aebfd2}.detail-content code{color:#8eb8ed;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}.card-list{display:grid;gap:8px;padding:14px}.card-list article{border:1px solid #20364d;border-radius:8px;padding:11px;background:#0c1929}.card-list header{display:flex;justify-content:space-between;gap:12px}.card-list strong{color:#c6d6e7;font-size:10px}.card-list header span{color:#6d85a0;font-size:8px}.card-list p{margin:6px 0 0;color:#7b91aa;font-size:9px}.definition-view{padding:18px 20px}.definition-view dl{display:grid;grid-template-columns:120px 1fr;gap:6px 12px;margin:0 0 16px;font-size:9px}.definition-view dt{color:#607995}.definition-view dd{margin:0;color:#b5c5d7}.definition-view pre{overflow:auto;margin:0;border:1px solid #20344a;border-radius:8px;padding:14px;background:#081421;color:#b9cce0;font-size:10px;line-height:1.55;white-space:pre-wrap}.empty-state{padding:26px;color:#6f849d;text-align:center;font-size:9px}.activity-bar{min-height:29px;display:flex;gap:8px;align-items:center;padding:6px 22px;border-top:1px solid #1a2a3e;background:#091422;color:#7489a2;font-size:9px}.activity-bar.error{color:#de8995}.activity-indicator{width:6px;height:6px;border-radius:50%;background:#4d83c9}.connection-status{margin-left:auto}@media(max-width:1180px){.explorer-layout{grid-template-columns:315px minmax(0,1fr)}}
</style>

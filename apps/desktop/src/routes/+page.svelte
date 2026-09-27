<script lang="ts">
  import { onMount, tick } from "svelte";
  import type {
    ConnectionCredential,
    ConnectionProfile,
    ConnectionProfileDraft,
  } from "@nublox/workbench-connection-profiles";

  import SqlEditor from "$lib/SqlEditor.svelte";
  import type {
    ExportFormat,
    OpenConnectionInfo,
    QueryExecutionView,
    QueryHistoryEntry,
    QueryRunMode,
  } from "$lib/desktop-api";

  type Workspace = "Developer" | "DBA" | "Architect" | "Data Engineer" | "Security";
  type Module = "connections" | "sql";

  interface EditableProfile {
    id: string;
    name: string;
    host: string;
    port: string;
    user: string;
    database: string;
    connectTimeoutMs: string;
    password: string;
    tlsEnabled: boolean;
    rejectUnauthorized: boolean;
    tlsCa: string;
    tlsCert: string;
    tlsPrivateKey: string;
  }

  const workspaces: readonly Workspace[] = [
    "Developer",
    "DBA",
    "Architect",
    "Data Engineer",
    "Security",
  ];

  let profiles: readonly ConnectionProfile[] = [];
  let openConnections: readonly OpenConnectionInfo[] = [];
  let queryHistory: readonly QueryHistoryEntry[] = [];
  let form = emptyProfile();
  let selectedId: string | undefined;
  let editingRevision: number | undefined;
  let activeConnectionId = "";
  let workspace: Workspace = "Developer";
  let activeModule: Module = "connections";
  let busy = false;
  let notice = "Ready";
  let errorMessage = "";
  let version = "";
  let sqlText = "SELECT VERSION() AS version;\n";
  let sqlEditor: SqlEditor;
  let currentExecution: QueryExecutionView | undefined;
  let activeResultIndex = 0;
  let runningExecutionId: string | undefined;

  $: selectedProfile = profiles.find((profile) => profile.id === selectedId);
  $: selectedConnection = openConnections.find((connection) => connection.profileId === selectedId);
  $: activeConnection = openConnections.find((connection) => connection.profileId === activeConnectionId);
  $: activeProfile = profiles.find((profile) => profile.id === activeConnectionId);
  $: selectedResult = currentExecution?.resultSets[activeResultIndex];

  onMount(() => {
    void refresh();
    void window.nublox.app.version().then((value) => {
      version = value;
    });
  });

  function emptyProfile(): EditableProfile {
    return {
      id: "",
      name: "",
      host: "localhost",
      port: "3306",
      user: "",
      database: "",
      connectTimeoutMs: "10000",
      password: "",
      tlsEnabled: false,
      rejectUnauthorized: true,
      tlsCa: "",
      tlsCert: "",
      tlsPrivateKey: "",
    };
  }

  async function refresh(): Promise<void> {
    try {
      const [nextProfiles, nextConnections, nextHistory] = await Promise.all([
        window.nublox.profiles.list(),
        window.nublox.connections.list(),
        window.nublox.history.list(80),
      ]);
      profiles = nextProfiles;
      openConnections = nextConnections;
      queryHistory = nextHistory;
      if (!openConnections.some((connection) => connection.profileId === activeConnectionId)) {
        activeConnectionId = openConnections.find((connection) => connection.profileId === selectedId)?.profileId
          ?? openConnections[0]?.profileId
          ?? "";
      }
    } catch (error) {
      setError(error);
    }
  }

  function selectProfile(profile: ConnectionProfile): void {
    selectedId = profile.id;
    editingRevision = profile.revision;
    form = {
      id: profile.id,
      name: profile.name,
      host: profile.host,
      port: profile.port === undefined ? "" : String(profile.port),
      user: profile.user,
      database: profile.database ?? "",
      connectTimeoutMs:
        profile.connectTimeoutMs === undefined ? "" : String(profile.connectTimeoutMs),
      password: "",
      tlsEnabled: profile.tls !== undefined,
      rejectUnauthorized: profile.tls?.rejectUnauthorized ?? true,
      tlsCa: profile.tls?.ca ?? "",
      tlsCert: profile.tls?.cert ?? "",
      tlsPrivateKey: "",
    };
    errorMessage = "";
    notice = profile.credentialId
      ? "Stored credential is available. Leave secret fields blank to keep it."
      : "No stored credential for this profile.";
  }

  function newProfile(): void {
    selectedId = undefined;
    editingRevision = undefined;
    form = emptyProfile();
    errorMessage = "";
    notice = "Creating a new MySQL connection profile.";
  }

  async function saveProfile(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    await runBusy(async () => {
      const draft = buildDraft();
      const credential = buildCredential();
      const saved = await window.nublox.profiles.save({
        draft,
        ...(editingRevision !== undefined ? { expectedRevision: editingRevision } : {}),
        ...(credential !== undefined ? { credential } : {}),
      });
      await refresh();
      selectProfile(saved);
      notice = `Saved '${saved.name}'.`;
    });
  }

  async function connectSelected(): Promise<void> {
    if (!selectedId) return;
    await runBusy(async () => {
      const connection = await window.nublox.connections.connect(selectedId!);
      activeConnectionId = connection.profileId;
      await refresh();
      notice = connection.healthy
        ? `Connected to ${selectedProfile?.name ?? selectedId}.`
        : "Connection opened but health check reported a problem.";
    });
  }

  async function disconnectSelected(): Promise<void> {
    if (!selectedId) return;
    await runBusy(async () => {
      await window.nublox.connections.disconnect(selectedId!);
      await refresh();
      notice = "Disconnected.";
    });
  }

  async function clearCredential(): Promise<void> {
    if (!selectedProfile?.credentialId) return;
    if (!window.confirm("Remove the securely stored credential for this profile?")) return;
    await runBusy(async () => {
      const updated = await window.nublox.profiles.clearCredential(selectedProfile!.id);
      await refresh();
      selectProfile(updated);
      notice = "Stored credential removed.";
    });
  }

  async function deleteSelected(): Promise<void> {
    if (!selectedProfile) return;
    if (!window.confirm(`Delete connection profile '${selectedProfile.name}'?`)) return;
    await runBusy(async () => {
      await window.nublox.profiles.remove({
        id: selectedProfile!.id,
        expectedRevision: selectedProfile!.revision,
      });
      newProfile();
      await refresh();
      notice = "Connection profile deleted.";
    });
  }

  function buildDraft(): ConnectionProfileDraft {
    const port = parseOptionalInteger(form.port, "Port");
    const connectTimeoutMs = parseOptionalInteger(form.connectTimeoutMs, "Connection timeout");
    const tls = form.tlsEnabled
      ? {
          ...(form.tlsCa.trim() ? { ca: form.tlsCa } : {}),
          ...(form.tlsCert.trim() ? { cert: form.tlsCert } : {}),
          rejectUnauthorized: form.rejectUnauthorized,
        }
      : undefined;

    return {
      id: form.id,
      name: form.name,
      providerId: "mysql",
      host: form.host,
      user: form.user,
      ...(port !== undefined ? { port } : {}),
      ...(form.database.trim() ? { database: form.database } : {}),
      ...(connectTimeoutMs !== undefined ? { connectTimeoutMs } : {}),
      ...(tls !== undefined ? { tls } : {}),
    };
  }

  function buildCredential(): ConnectionCredential | undefined {
    const password = form.password;
    const tlsPrivateKey = form.tlsPrivateKey;
    if (!password && !tlsPrivateKey) return undefined;
    return {
      ...(password ? { password } : {}),
      ...(tlsPrivateKey ? { tlsPrivateKey } : {}),
    };
  }

  async function showSqlEditor(): Promise<void> {
    activeModule = "sql";
    if (!activeConnectionId && selectedConnection) activeConnectionId = selectedConnection.profileId;
    await tick();
    sqlEditor?.focus();
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
      currentExecution = await window.nublox.queries.execute({
        executionId,
        connectionId: activeConnectionId,
        sql,
        mode,
      });
      activeResultIndex = 0;
      notice = `Completed ${currentExecution.statementCount} statement${currentExecution.statementCount === 1 ? "" : "s"} in ${currentExecution.elapsedMs} ms.`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancel/i.test(message)) {
        notice = "Query execution cancelled.";
        errorMessage = "";
      } else {
        setError(error);
      }
    } finally {
      runningExecutionId = undefined;
      queryHistory = await window.nublox.history.list(80).catch(() => queryHistory);
    }
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
    } catch (error) {
      setError(error);
    }
  }

  async function replayHistory(entry: QueryHistoryEntry): Promise<void> {
    sqlText = entry.sql;
    if (openConnections.some((connection) => connection.profileId === entry.connectionId)) {
      activeConnectionId = entry.connectionId;
    }
    activeModule = "sql";
    await tick();
    sqlEditor?.focus();
    notice = "Loaded SQL from query history.";
  }

  async function clearHistory(): Promise<void> {
    if (queryHistory.length === 0) return;
    if (!window.confirm("Clear all stored query history?")) return;
    try {
      await window.nublox.history.clear();
      queryHistory = [];
      notice = "Query history cleared.";
    } catch (error) {
      setError(error);
    }
  }

  function parseOptionalInteger(value: string, label: string): number | undefined {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`${label} must be a positive whole number.`);
    }
    return parsed;
  }

  async function runBusy(action: () => Promise<void>): Promise<void> {
    busy = true;
    errorMessage = "";
    try {
      await action();
    } catch (error) {
      setError(error);
    } finally {
      busy = false;
    }
  }

  function setError(error: unknown): void {
    errorMessage = error instanceof Error ? error.message : String(error);
    notice = "Action failed.";
  }

  function displayCell(value: string | number | boolean | null): string {
    if (value === null) return "NULL";
    return String(value);
  }

  function historyPreview(sql: string): string {
    return sql.replace(/\s+/gu, " ").trim();
  }
</script>

<svelte:head>
  <title>NuBlox SQL Workbench</title>
  <meta name="description" content="NuBlox SQL Workbench database engineering environment" />
</svelte:head>

<div class="app-shell">
  <aside class="sidebar">
    <div class="brand">
      <div class="brand-mark">NB</div>
      <div>
        <strong>NuBlox</strong>
        <span>SQL Workbench</span>
      </div>
    </div>

    <label class="workspace-picker">
      <span>Workspace</span>
      <select bind:value={workspace}>
        {#each workspaces as option}
          <option value={option}>{option}</option>
        {/each}
      </select>
    </label>

    <nav aria-label="Workbench modules">
      <button
        class="nav-item"
        class:active={activeModule === "connections"}
        type="button"
        onclick={() => (activeModule = "connections")}
      >
        <span class="nav-icon">◎</span>
        Connections
      </button>
      <button
        class="nav-item"
        class:active={activeModule === "sql"}
        type="button"
        onclick={showSqlEditor}
      >
        <span class="nav-icon">⌘</span>
        SQL Editor
      </button>
      <button class="nav-item" type="button" disabled>
        <span class="nav-icon">◇</span>
        Database Explorer
        <small>next</small>
      </button>
      <button class="nav-item" type="button" disabled>
        <span class="nav-icon">△</span>
        Schema Designer
      </button>
      <button class="nav-item" type="button" disabled>
        <span class="nav-icon">◫</span>
        Administration
      </button>
    </nav>

    <div class="sidebar-footer">
      <span>Workspace: {workspace}</span>
      {#if version}<span>v{version}</span>{/if}
    </div>
  </aside>

  <main class="main-area">
    <header class="topbar">
      <div>
        <p class="eyebrow">M1 · Desktop SQL Development</p>
        <h1>{activeModule === "connections" ? "Connection workspace" : "SQL Editor"}</h1>
        <p>
          {activeModule === "connections"
            ? "Manage database identities and live MySQL sessions."
            : "Author, execute, cancel, review and export SQL results."}
        </p>
      </div>
      <div class="status-pill" class:connected={Boolean(activeConnection)}>
        <span></span>
        {activeConnection ? `${activeProfile?.name ?? activeConnection.profileId} connected` : "No active session"}
      </div>
    </header>

    {#if activeModule === "connections"}
      <section class="workspace-grid connections-grid">
        <div class="panel profiles-panel">
          <div class="panel-heading">
            <div>
              <h2>Connections</h2>
              <p>{profiles.length} saved profile{profiles.length === 1 ? "" : "s"}</p>
            </div>
            <button class="secondary compact" type="button" onclick={newProfile}>New</button>
          </div>

          <div class="profile-list">
            {#if profiles.length === 0}
              <div class="empty-state">
                <strong>No saved connections</strong>
                <p>Create your first MySQL profile to begin.</p>
              </div>
            {:else}
              {#each profiles as profile (profile.id)}
                {@const connection = openConnections.find((item) => item.profileId === profile.id)}
                <button
                  type="button"
                  class="profile-card"
                  class:selected={profile.id === selectedId}
                  onclick={() => selectProfile(profile)}
                >
                  <span class="connection-dot" class:online={Boolean(connection)}></span>
                  <span class="profile-copy">
                    <strong>{profile.name}</strong>
                    <span>{profile.user || "(default user)"}@{profile.host}:{profile.port ?? 3306}</span>
                    <small>{profile.database ?? "All databases"} · MySQL</small>
                  </span>
                  <span class="profile-chevron">›</span>
                </button>
              {/each}
            {/if}
          </div>
        </div>

        <div class="panel editor-panel">
          <div class="panel-heading">
            <div>
              <h2>{editingRevision === undefined ? "New connection" : "Connection settings"}</h2>
              <p>Secrets are encrypted by the operating system and stored separately from this profile.</p>
            </div>
            {#if selectedProfile?.credentialId}
              <span class="secure-badge">Secure secret stored</span>
            {/if}
          </div>

          <form onsubmit={saveProfile}>
            <div class="form-grid two">
              <label>
                <span>Profile ID</span>
                <input bind:value={form.id} disabled={editingRevision !== undefined} required autocomplete="off" placeholder="local-mysql" />
              </label>
              <label>
                <span>Display name</span>
                <input bind:value={form.name} required autocomplete="off" placeholder="Local MySQL" />
              </label>
            </div>

            <div class="form-grid host-grid">
              <label>
                <span>Host</span>
                <input bind:value={form.host} required autocomplete="off" placeholder="localhost" />
              </label>
              <label>
                <span>Port</span>
                <input bind:value={form.port} inputmode="numeric" placeholder="3306" />
              </label>
            </div>

            <div class="form-grid two">
              <label>
                <span>User</span>
                <input bind:value={form.user} autocomplete="username" placeholder="root" />
              </label>
              <label>
                <span>Default database</span>
                <input bind:value={form.database} autocomplete="off" placeholder="Optional" />
              </label>
            </div>

            <div class="form-grid two">
              <label>
                <span>Password</span>
                <input type="password" bind:value={form.password} autocomplete="new-password" placeholder={selectedProfile?.credentialId ? "Leave blank to keep stored password" : "Optional"} />
              </label>
              <label>
                <span>Connect timeout (ms)</span>
                <input bind:value={form.connectTimeoutMs} inputmode="numeric" placeholder="10000" />
              </label>
            </div>

            <label class="checkbox-row tls-toggle">
              <input type="checkbox" bind:checked={form.tlsEnabled} />
              Enable TLS
            </label>

            {#if form.tlsEnabled}
              <div class="tls-section">
                <label class="checkbox-row">
                  <input type="checkbox" bind:checked={form.rejectUnauthorized} />
                  Verify server certificate
                </label>
                <label>
                  <span>CA certificate</span>
                  <textarea bind:value={form.tlsCa} rows="3" placeholder="PEM certificate (optional)"></textarea>
                </label>
                <label>
                  <span>Client certificate</span>
                  <textarea bind:value={form.tlsCert} rows="3" placeholder="PEM certificate (optional)"></textarea>
                </label>
                <label>
                  <span>Client private key</span>
                  <textarea bind:value={form.tlsPrivateKey} rows="3" placeholder={selectedProfile?.credentialId ? "Leave blank to keep stored key" : "Stored securely"}></textarea>
                </label>
              </div>
            {/if}

            <div class="form-actions">
              <button class="primary" type="submit" disabled={busy}>
                {editingRevision === undefined ? "Save connection" : "Save changes"}
              </button>

              {#if selectedProfile}
                {#if selectedConnection}
                  <button class="secondary" type="button" disabled={busy} onclick={disconnectSelected}>Disconnect</button>
                  <button class="secondary" type="button" disabled={busy} onclick={showSqlEditor}>Open SQL editor</button>
                {:else}
                  <button class="secondary" type="button" disabled={busy} onclick={connectSelected}>Connect</button>
                {/if}
                {#if selectedProfile.credentialId}
                  <button class="quiet" type="button" disabled={busy} onclick={clearCredential}>Clear secret</button>
                {/if}
                <button class="danger" type="button" disabled={busy} onclick={deleteSelected}>Delete</button>
              {/if}
            </div>
          </form>

          {#if selectedConnection}
            <div class="connection-summary">
              <div><span>Session health</span><strong>{selectedConnection.healthy ? "Healthy" : "Attention required"}</strong></div>
              <div><span>Provider</span><strong>{selectedConnection.providerId}</strong></div>
              <div><span>Latency</span><strong>{selectedConnection.latencyMs === undefined ? "—" : `${selectedConnection.latencyMs} ms`}</strong></div>
            </div>
          {/if}
        </div>
      </section>
    {:else}
      <section class="sql-layout">
        <div class="sql-main">
          <div class="panel sql-editor-panel">
            <div class="sql-toolbar">
              <label class="connection-picker">
                <span>Connection</span>
                <select bind:value={activeConnectionId} disabled={Boolean(runningExecutionId)}>
                  <option value="">Select an open connection</option>
                  {#each openConnections as connection (connection.profileId)}
                    {@const profile = profiles.find((item) => item.id === connection.profileId)}
                    <option value={connection.profileId}>{profile?.name ?? connection.profileId}</option>
                  {/each}
                </select>
              </label>
              <div class="query-actions">
                <button class="primary" type="button" disabled={Boolean(runningExecutionId)} onclick={() => executeSql("statement")}>Run statement</button>
                <button class="secondary" type="button" disabled={Boolean(runningExecutionId)} onclick={() => executeSql("selection")}>Run selection</button>
                <button class="secondary" type="button" disabled={Boolean(runningExecutionId)} onclick={() => executeSql("script")}>Run script</button>
                <button class="stop" type="button" disabled={!runningExecutionId} onclick={cancelQuery}>Cancel</button>
              </div>
            </div>
            <div class="editor-host">
              <SqlEditor bind:this={sqlEditor} bind:value={sqlText} readOnly={Boolean(runningExecutionId)} onRunStatement={() => executeSql("statement")} />
            </div>
            <div class="editor-status">
              <span>⌘/Ctrl + Enter runs the current statement</span>
              <span>{activeConnection ? `${activeConnection.providerId} · ${activeConnection.latencyMs ?? "—"} ms` : "Disconnected"}</span>
            </div>
          </div>

          <div class="panel results-panel">
            <div class="panel-heading results-heading">
              <div>
                <h2>Results</h2>
                <p>
                  {currentExecution
                    ? `${currentExecution.resultSets.length} result set${currentExecution.resultSets.length === 1 ? "" : "s"} · ${currentExecution.elapsedMs} ms`
                    : "Run SQL to populate results."}
                </p>
              </div>
              {#if selectedResult}
                <div class="export-actions">
                  <button class="quiet" type="button" onclick={() => exportSelected("csv")}>Export CSV</button>
                  <button class="quiet" type="button" onclick={() => exportSelected("json")}>Export JSON</button>
                </div>
              {/if}
            </div>

            {#if currentExecution && currentExecution.resultSets.length > 0}
              <div class="result-tabs" role="tablist" aria-label="Query result sets">
                {#each currentExecution.resultSets as resultSet, index}
                  <button type="button" class:active={activeResultIndex === index} onclick={() => (activeResultIndex = index)}>
                    Result {index + 1}
                    {#if resultSet.rows.length > 0}<small>{resultSet.rows.length} rows</small>{/if}
                  </button>
                {/each}
              </div>

              {#if selectedResult}
                {#if selectedResult.columns.length > 0}
                  <div class="result-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          {#each selectedResult.columns as column}
                            <th title={column.databaseType ?? column.name}>{column.name}</th>
                          {/each}
                        </tr>
                      </thead>
                      <tbody>
                        {#each selectedResult.rows as row}
                          <tr>
                            {#each selectedResult.columns as column}
                              <td class:null-value={row[column.name] === null}>{displayCell(row[column.name] ?? null)}</td>
                            {/each}
                          </tr>
                        {/each}
                      </tbody>
                    </table>
                  </div>
                {:else}
                  <div class="result-summary">
                    <div><span>Affected</span><strong>{selectedResult.affectedRows ?? 0}</strong></div>
                    <div><span>Changed</span><strong>{selectedResult.changedRows ?? 0}</strong></div>
                    <div><span>Warnings</span><strong>{selectedResult.warningCount ?? 0}</strong></div>
                    {#if selectedResult.message}<p>{selectedResult.message}</p>{/if}
                  </div>
                {/if}
              {/if}
            {:else}
              <div class="empty-results">
                <strong>No query results yet</strong>
                <p>Run the current statement, a selection, or the full script.</p>
              </div>
            {/if}
          </div>
        </div>

        <aside class="panel history-panel">
          <div class="panel-heading">
            <div><h2>Query history</h2><p>Latest {queryHistory.length} executions</p></div>
            <button class="quiet compact" type="button" disabled={queryHistory.length === 0} onclick={clearHistory}>Clear</button>
          </div>
          <div class="history-list">
            {#if queryHistory.length === 0}
              <div class="empty-state"><strong>No history</strong><p>Executed SQL will appear here.</p></div>
            {:else}
              {#each queryHistory as entry (entry.id)}
                <button class="history-entry" type="button" onclick={() => replayHistory(entry)}>
                  <span class="history-topline">
                    <span class="history-status" class:success={entry.status === "success"} class:error={entry.status === "error"} class:cancelled={entry.status === "cancelled"}>{entry.status}</span>
                    <span>{entry.elapsedMs} ms</span>
                  </span>
                  <strong>{historyPreview(entry.sql)}</strong>
                  <small>{profiles.find((profile) => profile.id === entry.connectionId)?.name ?? entry.connectionId} · {entry.mode}</small>
                </button>
              {/each}
            {/if}
          </div>
        </aside>
      </section>
    {/if}

    <footer class="activity-bar" class:error={Boolean(errorMessage)}>
      <span class="activity-indicator"></span>
      <span>{errorMessage || notice}</span>
      {#if busy || runningExecutionId}<span class="activity-busy">Working…</span>{/if}
    </footer>
  </main>
</div>

<style>
  :global(*) { box-sizing: border-box; }
  :global(html), :global(body) {
    margin: 0;
    min-width: 100%;
    min-height: 100%;
    background: #08111f;
    color: #dbe7f5;
    font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  :global(button), :global(input), :global(select), :global(textarea) { font: inherit; }

  .app-shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 238px minmax(0, 1fr);
    background: radial-gradient(circle at 70% -20%, rgba(49, 121, 229, 0.12), transparent 36rem), #08111f;
  }
  .sidebar { min-height: 100vh; display: flex; flex-direction: column; padding: 22px 15px 16px; border-right: 1px solid #1d2a3b; background: rgba(10, 20, 35, 0.96); }
  .brand { display: flex; gap: 11px; align-items: center; padding: 0 7px 24px; }
  .brand-mark { width: 36px; height: 36px; display: grid; place-items: center; border-radius: 9px; background: linear-gradient(145deg, #4d93ff, #2863c7); color: white; font-weight: 800; font-size: 12px; }
  .brand strong, .brand span { display: block; }
  .brand strong { color: #f5f9ff; font-size: 15px; }
  .brand span { margin-top: 1px; color: #7f92aa; font-size: 12px; }
  .workspace-picker { margin: 0 7px 23px; }
  .workspace-picker > span, .connection-picker > span { display: block; margin-bottom: 7px; color: #7588a1; font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
  .workspace-picker select { width: 100%; }
  nav { display: grid; gap: 4px; }
  .nav-item { width: 100%; display: grid; grid-template-columns: 24px 1fr auto; gap: 6px; align-items: center; border: 0; border-radius: 8px; padding: 10px 9px; background: transparent; color: #92a5bc; text-align: left; cursor: pointer; }
  .nav-item.active { background: #16263a; color: #e7f0fc; }
  .nav-item:disabled { opacity: 0.55; cursor: default; }
  .nav-item small { color: #58718f; font-size: 9px; text-transform: uppercase; }
  .nav-icon { color: #629cff; text-align: center; }
  .sidebar-footer { margin-top: auto; display: flex; justify-content: space-between; padding: 14px 7px 0; border-top: 1px solid #1b2a3d; color: #60748d; font-size: 10px; }

  .main-area { min-width: 0; min-height: 100vh; display: flex; flex-direction: column; }
  .topbar { display: flex; justify-content: space-between; gap: 30px; align-items: flex-start; padding: 24px 28px 18px; border-bottom: 1px solid #18283a; }
  .eyebrow { margin: 0 0 7px; color: #5795f6; font-size: 10px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; }
  h1, h2, p { margin-top: 0; }
  h1 { margin-bottom: 6px; color: #f3f7fc; font-size: 25px; font-weight: 670; letter-spacing: -0.02em; }
  .topbar p:last-child { margin-bottom: 0; color: #8296af; font-size: 13px; }
  .status-pill { display: flex; gap: 8px; align-items: center; margin-top: 4px; border: 1px solid #29394d; border-radius: 999px; padding: 7px 11px; color: #8fa2b9; background: #0d1928; font-size: 11px; white-space: nowrap; }
  .status-pill span { width: 7px; height: 7px; border-radius: 50%; background: #607087; }
  .status-pill.connected { border-color: #1f5a47; color: #8fd8bb; }
  .status-pill.connected span, .connection-dot.online { background: #40c58b; box-shadow: 0 0 0 3px rgba(64, 197, 139, 0.12); }

  .workspace-grid { flex: 1; min-height: 0; display: grid; gap: 16px; padding: 20px 22px; }
  .connections-grid { grid-template-columns: minmax(285px, 0.72fr) minmax(560px, 1.6fr); }
  .panel { min-width: 0; border: 1px solid #1e3044; border-radius: 11px; background: rgba(13, 25, 41, 0.86); box-shadow: 0 18px 50px rgba(0, 0, 0, 0.16); overflow: hidden; }
  .editor-panel { padding-bottom: 20px; overflow: visible; }
  .panel-heading { display: flex; justify-content: space-between; gap: 20px; align-items: center; padding: 16px 18px; border-bottom: 1px solid #1b2c3f; }
  .panel-heading h2 { margin-bottom: 3px; color: #eef5fd; font-size: 14px; }
  .panel-heading p { margin: 0; color: #71869e; font-size: 11px; line-height: 1.45; }
  .profile-list { display: grid; gap: 4px; padding: 9px; }
  .profile-card { width: 100%; display: grid; grid-template-columns: 12px 1fr 16px; gap: 10px; align-items: center; border: 1px solid transparent; border-radius: 8px; padding: 12px 10px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
  .profile-card:hover, .profile-card.selected { border-color: #28476a; background: #12243a; }
  .connection-dot { width: 7px; height: 7px; border-radius: 50%; background: #495b70; }
  .profile-copy { min-width: 0; }
  .profile-copy strong, .profile-copy span, .profile-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .profile-copy strong { color: #dfeaf7; font-size: 12px; }
  .profile-copy span { margin-top: 3px; color: #879ab1; font-size: 10px; }
  .profile-copy small { margin-top: 3px; color: #5f7590; font-size: 9px; }
  .profile-chevron { color: #5d7591; font-size: 17px; }
  .empty-state, .empty-results { margin: 35px 18px; padding: 24px 16px; border: 1px dashed #2a4059; border-radius: 9px; color: #8095ae; text-align: center; }
  .empty-state strong, .empty-results strong { display: block; color: #cddbeb; font-size: 12px; }
  .empty-state p, .empty-results p { margin: 6px 0 0; font-size: 10px; }

  form { padding: 20px; }
  .form-grid { display: grid; gap: 14px; margin-bottom: 14px; }
  .form-grid.two { grid-template-columns: 1fr 1fr; }
  .host-grid { grid-template-columns: 1fr 120px; }
  label > span, .tls-section label > span { display: block; margin-bottom: 6px; color: #8398b2; font-size: 10px; font-weight: 600; }
  input, select, textarea { width: 100%; border: 1px solid #263a52; border-radius: 7px; padding: 9px 10px; background: #0b1726; color: #e0ebf7; outline: none; transition: border-color 120ms ease; }
  input:focus, select:focus, textarea:focus { border-color: #4d83c9; }
  input:disabled, select:disabled { color: #71839a; background: #0e1825; }
  textarea { resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10px; line-height: 1.45; }
  .checkbox-row { display: flex; gap: 8px; align-items: center; color: #8296ad; font-size: 10px; }
  .checkbox-row input { width: auto; }
  .tls-toggle { margin: 16px 0 10px; }
  .tls-section { display: grid; gap: 12px; margin: 0 0 17px; border: 1px solid #20344b; border-radius: 8px; padding: 12px; background: #0c1928; }
  .secure-badge { border: 1px solid #285d4b; border-radius: 999px; padding: 5px 8px; color: #74caa7; background: rgba(34, 101, 75, 0.14); font-size: 9px; white-space: nowrap; }
  .form-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; padding-top: 4px; }

  button.primary, button.secondary, button.quiet, button.danger, button.stop { border-radius: 7px; padding: 8px 12px; cursor: pointer; font-size: 10px; font-weight: 650; }
  button:disabled { cursor: default; opacity: 0.55; }
  button.primary { border: 1px solid #4a86dd; background: #3477d8; color: white; }
  button.secondary { border: 1px solid #304966; background: #14263b; color: #bfd0e3; }
  button.secondary.compact, button.quiet.compact { padding: 6px 9px; }
  button.quiet { border: 1px solid transparent; background: transparent; color: #7991ad; }
  button.danger { margin-left: auto; border: 1px solid #60343d; background: #25151c; color: #d98a96; }
  button.stop { border: 1px solid #70404a; background: #29171e; color: #ec9aa5; }

  .connection-summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; margin: 0 20px; overflow: hidden; border: 1px solid #20364c; border-radius: 8px; background: #20364c; }
  .connection-summary div { padding: 10px 12px; background: #0c1a29; }
  .connection-summary span, .connection-summary strong { display: block; }
  .connection-summary span { margin-bottom: 3px; color: #667e99; font-size: 9px; text-transform: uppercase; }
  .connection-summary strong { color: #b9cbe0; font-size: 10px; }

  .sql-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 14px; padding: 16px 18px; }
  .sql-main { min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(360px, 1fr) minmax(250px, 0.85fr); gap: 14px; }
  .sql-editor-panel, .results-panel, .history-panel { min-height: 0; }
  .sql-editor-panel { display: grid; grid-template-rows: auto minmax(280px, 1fr) auto; }
  .sql-toolbar { display: flex; gap: 16px; align-items: end; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid #1b2c3f; background: #0b1725; }
  .connection-picker { min-width: 220px; max-width: 340px; flex: 1; }
  .connection-picker > span { margin-bottom: 4px; }
  .connection-picker select { padding: 7px 9px; }
  .query-actions { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
  .editor-host { min-height: 0; }
  .editor-status { display: flex; justify-content: space-between; gap: 12px; padding: 7px 12px; border-top: 1px solid #1b2c3f; color: #60758d; background: #091421; font-size: 9px; }

  .results-panel { display: flex; flex-direction: column; }
  .results-heading { min-height: 61px; }
  .export-actions { display: flex; gap: 4px; }
  .result-tabs { display: flex; gap: 2px; overflow-x: auto; padding: 7px 8px 0; border-bottom: 1px solid #1b2c3f; background: #0a1624; }
  .result-tabs button { display: flex; gap: 6px; align-items: center; border: 0; border-bottom: 2px solid transparent; padding: 7px 10px 8px; background: transparent; color: #71869e; cursor: pointer; font-size: 10px; }
  .result-tabs button.active { border-bottom-color: #4d8ff2; color: #dce8f6; }
  .result-tabs small { color: #526a84; font-size: 8px; }
  .result-table-wrap { flex: 1; min-height: 0; overflow: auto; }
  table { width: 100%; border-collapse: collapse; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10px; }
  th { position: sticky; top: 0; z-index: 1; padding: 8px 10px; border-right: 1px solid #22354a; border-bottom: 1px solid #2b4057; background: #102034; color: #a7bad0; text-align: left; white-space: nowrap; }
  td { max-width: 420px; padding: 7px 10px; border-right: 1px solid #17283b; border-bottom: 1px solid #17283b; color: #c4d3e4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  tr:hover td { background: #0e1d2e; }
  td.null-value { color: #596e87; font-style: italic; }
  .result-summary { display: grid; grid-template-columns: repeat(3, minmax(100px, 1fr)); gap: 1px; margin: 18px; border: 1px solid #21354a; border-radius: 8px; overflow: hidden; background: #21354a; }
  .result-summary div { padding: 15px; background: #0c1928; }
  .result-summary span, .result-summary strong { display: block; }
  .result-summary span { color: #667d98; font-size: 9px; text-transform: uppercase; }
  .result-summary strong { margin-top: 3px; color: #d3e1ef; font-size: 17px; }
  .result-summary p { grid-column: 1 / -1; margin: 0; padding: 10px 14px; background: #0b1725; color: #7f94ad; font-size: 10px; }

  .history-panel { display: flex; flex-direction: column; }
  .history-list { min-height: 0; overflow-y: auto; padding: 7px; }
  .history-entry { width: 100%; display: grid; gap: 5px; border: 1px solid transparent; border-radius: 7px; padding: 9px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
  .history-entry:hover { border-color: #27415e; background: #102137; }
  .history-topline { display: flex; justify-content: space-between; gap: 8px; color: #5d7590; font-size: 8px; text-transform: uppercase; }
  .history-status.success { color: #5bc89a; }
  .history-status.error { color: #df7b89; }
  .history-status.cancelled { color: #d9a55d; }
  .history-entry strong { display: -webkit-box; overflow: hidden; color: #c6d5e6; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 9px; font-weight: 500; line-height: 1.4; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .history-entry small { overflow: hidden; color: #617891; font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }

  .activity-bar { min-height: 29px; display: flex; gap: 8px; align-items: center; padding: 6px 22px; border-top: 1px solid #1a2a3e; background: #091422; color: #7489a2; font-size: 9px; }
  .activity-bar.error { color: #de8995; }
  .activity-indicator { width: 6px; height: 6px; border-radius: 50%; background: #4d83c9; }
  .activity-bar.error .activity-indicator { background: #d55767; }
  .activity-busy { margin-left: auto; }

  @media (max-width: 1180px) {
    .app-shell { grid-template-columns: 205px minmax(0, 1fr); }
    .connections-grid { grid-template-columns: 300px minmax(480px, 1fr); }
    .sql-layout { grid-template-columns: minmax(0, 1fr) 250px; }
    .sql-toolbar { align-items: stretch; flex-direction: column; }
    .connection-picker { max-width: none; }
    .query-actions { justify-content: flex-start; }
  }
</style>

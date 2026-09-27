<script lang="ts">
  import { onMount } from "svelte";
  import type {
    ConnectionCredential,
    ConnectionProfile,
    ConnectionProfileDraft,
  } from "@nublox/workbench-connection-profiles";
  import type { OpenConnectionInfo } from "$lib/desktop-api";

  type Workspace = "Developer" | "DBA" | "Architect" | "Data Engineer" | "Security";

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
  let form = emptyProfile();
  let selectedId: string | undefined;
  let editingRevision: number | undefined;
  let workspace: Workspace = "Developer";
  let busy = false;
  let notice = "Ready";
  let errorMessage = "";
  let version = "";

  $: selectedProfile = profiles.find((profile) => profile.id === selectedId);
  $: selectedConnection = openConnections.find((connection) => connection.profileId === selectedId);

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
      const [nextProfiles, nextConnections] = await Promise.all([
        window.nublox.profiles.list(),
        window.nublox.connections.list(),
      ]);
      profiles = nextProfiles;
      openConnections = nextConnections;
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
      await refresh();
      notice = connection.healthy
        ? `Connected to ${selectedProfile?.name ?? selectedId}.`
        : `Connection opened but health check reported a problem.`;
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
</script>

<svelte:head>
  <title>NuBlox SQL Workbench</title>
  <meta
    name="description"
    content="NuBlox SQL Workbench database engineering environment"
  />
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
      <button class="nav-item active" type="button">
        <span class="nav-icon">◎</span>
        Connections
      </button>
      <button class="nav-item" type="button" disabled>
        <span class="nav-icon">⌘</span>
        SQL Editor
        <small>next</small>
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
        <h1>Connection workspace</h1>
        <p>Manage database identities and open live MySQL sessions from the desktop shell.</p>
      </div>
      <div class="status-pill" class:connected={Boolean(selectedConnection)}>
        <span></span>
        {selectedConnection ? "Connected" : "No active session"}
      </div>
    </header>

    <section class="workspace-grid">
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
              <input
                bind:value={form.id}
                disabled={editingRevision !== undefined}
                required
                autocomplete="off"
                placeholder="local-mysql"
              />
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
              <input
                type="password"
                bind:value={form.password}
                autocomplete="new-password"
                placeholder={selectedProfile?.credentialId ? "Leave blank to keep stored password" : "Optional"}
              />
            </label>
            <label>
              <span>Connect timeout (ms)</span>
              <input bind:value={form.connectTimeoutMs} inputmode="numeric" placeholder="10000" />
            </label>
          </div>

          <details class="tls-section" open={form.tlsEnabled}>
            <summary>
              <span>TLS</span>
              <label class="switch-label" onclick={(event) => event.stopPropagation()}>
                <input type="checkbox" bind:checked={form.tlsEnabled} />
                Enable TLS
              </label>
            </summary>

            {#if form.tlsEnabled}
              <div class="tls-fields">
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
                  <textarea
                    bind:value={form.tlsPrivateKey}
                    rows="3"
                    placeholder={selectedProfile?.credentialId ? "Leave blank to keep stored key" : "Stored securely"}
                  ></textarea>
                </label>
              </div>
            {/if}
          </details>

          <div class="form-actions">
            <button class="primary" type="submit" disabled={busy}>
              {editingRevision === undefined ? "Save connection" : "Save changes"}
            </button>

            {#if selectedProfile}
              {#if selectedConnection}
                <button class="secondary" type="button" disabled={busy} onclick={disconnectSelected}>
                  Disconnect
                </button>
              {:else}
                <button class="secondary" type="button" disabled={busy} onclick={connectSelected}>
                  Connect
                </button>
              {/if}
              {#if selectedProfile.credentialId}
                <button class="quiet" type="button" disabled={busy} onclick={clearCredential}>
                  Clear secret
                </button>
              {/if}
              <button class="danger" type="button" disabled={busy} onclick={deleteSelected}>
                Delete
              </button>
            {/if}
          </div>
        </form>

        {#if selectedConnection}
          <div class="connection-summary">
            <div>
              <span>Session health</span>
              <strong>{selectedConnection.healthy ? "Healthy" : "Attention required"}</strong>
            </div>
            <div>
              <span>Provider</span>
              <strong>{selectedConnection.providerId}</strong>
            </div>
            <div>
              <span>Latency</span>
              <strong>{selectedConnection.latencyMs === undefined ? "—" : `${selectedConnection.latencyMs} ms`}</strong>
            </div>
          </div>
        {/if}
      </div>
    </section>

    <footer class="activity-bar" class:error={Boolean(errorMessage)}>
      <span class="activity-indicator"></span>
      <span>{errorMessage || notice}</span>
      {#if busy}<span class="activity-busy">Working…</span>{/if}
    </footer>
  </main>
</div>

<style>
  :global(*) {
    box-sizing: border-box;
  }

  :global(html),
  :global(body) {
    margin: 0;
    min-width: 100%;
    min-height: 100%;
    background: #08111f;
    color: #dbe7f5;
    font-family:
      Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }

  :global(button),
  :global(input),
  :global(select),
  :global(textarea) {
    font: inherit;
  }

  .app-shell {
    min-height: 100vh;
    display: grid;
    grid-template-columns: 238px 1fr;
    background:
      radial-gradient(circle at 70% -20%, rgba(49, 121, 229, 0.12), transparent 36rem),
      #08111f;
  }

  .sidebar {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    padding: 22px 15px 16px;
    border-right: 1px solid #1d2a3b;
    background: rgba(10, 20, 35, 0.96);
  }

  .brand {
    display: flex;
    gap: 11px;
    align-items: center;
    padding: 0 7px 24px;
  }

  .brand-mark {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 9px;
    background: linear-gradient(145deg, #4d93ff, #2863c7);
    color: white;
    font-weight: 800;
    font-size: 12px;
    letter-spacing: 0.04em;
  }

  .brand strong,
  .brand span {
    display: block;
  }

  .brand strong {
    color: #f5f9ff;
    font-size: 15px;
  }

  .brand span {
    margin-top: 1px;
    color: #7f92aa;
    font-size: 12px;
  }

  .workspace-picker {
    margin: 0 7px 23px;
  }

  .workspace-picker span {
    display: block;
    margin-bottom: 7px;
    color: #7588a1;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .workspace-picker select {
    width: 100%;
    border: 1px solid #293a50;
    border-radius: 8px;
    padding: 9px 10px;
    background: #101c2c;
    color: #dbe7f5;
    outline: none;
  }

  nav {
    display: grid;
    gap: 4px;
  }

  .nav-item {
    width: 100%;
    display: grid;
    grid-template-columns: 24px 1fr auto;
    gap: 6px;
    align-items: center;
    border: 0;
    border-radius: 8px;
    padding: 10px 9px;
    background: transparent;
    color: #92a5bc;
    text-align: left;
  }

  .nav-item.active {
    background: #16263a;
    color: #e7f0fc;
  }

  .nav-item:disabled {
    opacity: 0.55;
  }

  .nav-item small {
    color: #58718f;
    font-size: 9px;
    text-transform: uppercase;
  }

  .nav-icon {
    color: #629cff;
    text-align: center;
  }

  .sidebar-footer {
    margin-top: auto;
    display: flex;
    justify-content: space-between;
    padding: 14px 7px 0;
    border-top: 1px solid #1b2a3d;
    color: #60748d;
    font-size: 10px;
  }

  .main-area {
    min-width: 0;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .topbar {
    display: flex;
    justify-content: space-between;
    gap: 30px;
    align-items: flex-start;
    padding: 30px 34px 22px;
    border-bottom: 1px solid #18283a;
  }

  .eyebrow {
    margin: 0 0 7px;
    color: #5795f6;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  h1,
  h2,
  p {
    margin-top: 0;
  }

  h1 {
    margin-bottom: 6px;
    color: #f3f7fc;
    font-size: 25px;
    font-weight: 670;
    letter-spacing: -0.02em;
  }

  .topbar p:last-child {
    margin-bottom: 0;
    color: #8296af;
    font-size: 13px;
  }

  .status-pill {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 4px;
    border: 1px solid #29394d;
    border-radius: 999px;
    padding: 7px 11px;
    color: #8fa2b9;
    background: #0d1928;
    font-size: 11px;
    white-space: nowrap;
  }

  .status-pill span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #607087;
  }

  .status-pill.connected {
    border-color: #1f5a47;
    color: #8fd8bb;
  }

  .status-pill.connected span,
  .connection-dot.online {
    background: #40c58b;
    box-shadow: 0 0 0 3px rgba(64, 197, 139, 0.12);
  }

  .workspace-grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(285px, 0.72fr) minmax(560px, 1.6fr);
    gap: 16px;
    padding: 20px 22px;
  }

  .panel {
    min-width: 0;
    border: 1px solid #1e3044;
    border-radius: 11px;
    background: rgba(13, 25, 41, 0.86);
    box-shadow: 0 18px 50px rgba(0, 0, 0, 0.16);
  }

  .profiles-panel {
    overflow: hidden;
  }

  .editor-panel {
    padding-bottom: 20px;
  }

  .panel-heading {
    display: flex;
    justify-content: space-between;
    gap: 20px;
    align-items: center;
    padding: 18px 19px;
    border-bottom: 1px solid #1b2c3f;
  }

  .panel-heading h2 {
    margin-bottom: 3px;
    color: #eef5fd;
    font-size: 14px;
  }

  .panel-heading p {
    margin: 0;
    color: #71869e;
    font-size: 11px;
    line-height: 1.45;
  }

  .profile-list {
    display: grid;
    gap: 4px;
    padding: 9px;
  }

  .profile-card {
    width: 100%;
    display: grid;
    grid-template-columns: 12px 1fr 16px;
    gap: 10px;
    align-items: center;
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 12px 10px;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .profile-card:hover,
  .profile-card.selected {
    border-color: #28476a;
    background: #12243a;
  }

  .connection-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #495b70;
  }

  .profile-copy {
    min-width: 0;
  }

  .profile-copy strong,
  .profile-copy span,
  .profile-copy small {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-copy strong {
    color: #dfeaf7;
    font-size: 12px;
  }

  .profile-copy span {
    margin-top: 3px;
    color: #879ab1;
    font-size: 10px;
  }

  .profile-copy small {
    margin-top: 3px;
    color: #5f7590;
    font-size: 9px;
  }

  .profile-chevron {
    color: #5d7591;
    font-size: 17px;
  }

  .empty-state {
    margin: 35px 18px;
    padding: 24px 16px;
    border: 1px dashed #2a4059;
    border-radius: 9px;
    color: #8095ae;
    text-align: center;
  }

  .empty-state strong {
    display: block;
    color: #cddbeb;
    font-size: 12px;
  }

  .empty-state p {
    margin: 6px 0 0;
    font-size: 10px;
  }

  form {
    padding: 20px;
  }

  .form-grid {
    display: grid;
    gap: 14px;
    margin-bottom: 14px;
  }

  .form-grid.two {
    grid-template-columns: 1fr 1fr;
  }

  .host-grid {
    grid-template-columns: 1fr 120px;
  }

  label > span,
  .tls-fields label > span {
    display: block;
    margin-bottom: 6px;
    color: #8398b2;
    font-size: 10px;
    font-weight: 600;
  }

  input,
  select,
  textarea {
    width: 100%;
    border: 1px solid #263a52;
    border-radius: 7px;
    padding: 9px 10px;
    background: #0b1726;
    color: #e0ebf7;
    outline: none;
    transition: border-color 120ms ease;
  }

  input:focus,
  select:focus,
  textarea:focus {
    border-color: #4d83c9;
  }

  input:disabled {
    color: #71839a;
    background: #0e1825;
  }

  textarea {
    resize: vertical;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 10px;
    line-height: 1.45;
  }

  .tls-section {
    margin: 17px 0;
    border: 1px solid #20344b;
    border-radius: 8px;
    background: #0c1928;
  }

  .tls-section summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 11px 12px;
    color: #b8c8da;
    font-size: 11px;
    cursor: pointer;
    list-style: none;
  }

  .switch-label,
  .checkbox-row {
    display: flex;
    gap: 8px;
    align-items: center;
    color: #8296ad;
    font-size: 10px;
  }

  .switch-label input,
  .checkbox-row input {
    width: auto;
  }

  .tls-fields {
    display: grid;
    gap: 12px;
    padding: 0 12px 13px;
  }

  .secure-badge {
    border: 1px solid #285d4b;
    border-radius: 999px;
    padding: 5px 8px;
    color: #74caa7;
    background: rgba(34, 101, 75, 0.14);
    font-size: 9px;
    white-space: nowrap;
  }

  .form-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    padding-top: 4px;
  }

  button.primary,
  button.secondary,
  button.quiet,
  button.danger {
    border-radius: 7px;
    padding: 8px 12px;
    cursor: pointer;
    font-size: 10px;
    font-weight: 650;
  }

  button:disabled {
    cursor: default;
    opacity: 0.55;
  }

  button.primary {
    border: 1px solid #4a86dd;
    background: #3477d8;
    color: white;
  }

  button.secondary {
    border: 1px solid #304966;
    background: #14263b;
    color: #bfd0e3;
  }

  button.secondary.compact {
    padding: 6px 9px;
  }

  button.quiet {
    border: 1px solid transparent;
    background: transparent;
    color: #7991ad;
  }

  button.danger {
    margin-left: auto;
    border: 1px solid #60343d;
    background: #25151c;
    color: #d98a96;
  }

  .connection-summary {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1px;
    margin: 0 20px;
    overflow: hidden;
    border: 1px solid #20364c;
    border-radius: 8px;
    background: #20364c;
  }

  .connection-summary div {
    padding: 10px 12px;
    background: #0c1a29;
  }

  .connection-summary span,
  .connection-summary strong {
    display: block;
  }

  .connection-summary span {
    margin-bottom: 3px;
    color: #667e99;
    font-size: 9px;
    text-transform: uppercase;
  }

  .connection-summary strong {
    color: #b9cbe0;
    font-size: 10px;
  }

  .activity-bar {
    min-height: 29px;
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 6px 22px;
    border-top: 1px solid #1a2a3e;
    background: #091422;
    color: #7489a2;
    font-size: 9px;
  }

  .activity-bar.error {
    color: #de8995;
  }

  .activity-indicator {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4d83c9;
  }

  .activity-bar.error .activity-indicator {
    background: #d55767;
  }

  .activity-busy {
    margin-left: auto;
  }

  @media (max-width: 1180px) {
    .app-shell {
      grid-template-columns: 205px 1fr;
    }

    .workspace-grid {
      grid-template-columns: 300px minmax(480px, 1fr);
    }
  }
</style>

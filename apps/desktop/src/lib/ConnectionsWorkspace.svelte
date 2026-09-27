<script lang="ts">
  import { onMount } from "svelte";
  import type {
    ConnectionCredential,
    ConnectionProfile,
    ConnectionProfileDraft,
  } from "@nublox/workbench-connection-profiles";
  import type { OpenConnectionInfo } from "$lib/desktop-api";

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

  let profiles: readonly ConnectionProfile[] = [];
  let openConnections: readonly OpenConnectionInfo[] = [];
  let form = emptyProfile();
  let selectedId: string | undefined;
  let editingRevision: number | undefined;
  let busy = false;
  let notice = "Ready";
  let errorMessage = "";

  $: selectedProfile = profiles.find((profile) => profile.id === selectedId);
  $: selectedConnection = openConnections.find((connection) => connection.profileId === selectedId);

  onMount(() => { void refresh(); });

  function emptyProfile(): EditableProfile {
    return {
      id: "", name: "", host: "localhost", port: "3306", user: "", database: "",
      connectTimeoutMs: "10000", password: "", tlsEnabled: false,
      rejectUnauthorized: true, tlsCa: "", tlsCert: "", tlsPrivateKey: "",
    };
  }

  async function refresh(): Promise<void> {
    try {
      [profiles, openConnections] = await Promise.all([
        window.nublox.profiles.list(),
        window.nublox.connections.list(),
      ]);
    } catch (error) { setError(error); }
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
      connectTimeoutMs: profile.connectTimeoutMs === undefined ? "" : String(profile.connectTimeoutMs),
      password: "",
      tlsEnabled: profile.tls !== undefined,
      rejectUnauthorized: profile.tls?.rejectUnauthorized ?? true,
      tlsCa: profile.tls?.ca ?? "",
      tlsCert: profile.tls?.cert ?? "",
      tlsPrivateKey: "",
    };
    errorMessage = "";
    notice = profile.credentialId
      ? "Stored credential available. Leave secret fields blank to keep it."
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
      const saved = await window.nublox.profiles.save({
        draft: buildDraft(),
        ...(editingRevision !== undefined ? { expectedRevision: editingRevision } : {}),
        ...(buildCredential() ? { credential: buildCredential() } : {}),
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
      notice = connection.healthy ? `Connected to ${selectedProfile?.name ?? selectedId}.` : "Connection opened; health check needs attention.";
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
      await window.nublox.profiles.remove({ id: selectedProfile!.id, expectedRevision: selectedProfile!.revision });
      newProfile();
      await refresh();
      notice = "Connection profile deleted.";
    });
  }

  function buildDraft(): ConnectionProfileDraft {
    const port = parseOptionalInteger(form.port, "Port");
    const connectTimeoutMs = parseOptionalInteger(form.connectTimeoutMs, "Connection timeout");
    const tls = form.tlsEnabled ? {
      ...(form.tlsCa.trim() ? { ca: form.tlsCa } : {}),
      ...(form.tlsCert.trim() ? { cert: form.tlsCert } : {}),
      rejectUnauthorized: form.rejectUnauthorized,
    } : undefined;
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
    if (!form.password && !form.tlsPrivateKey) return undefined;
    return {
      ...(form.password ? { password: form.password } : {}),
      ...(form.tlsPrivateKey ? { tlsPrivateKey: form.tlsPrivateKey } : {}),
    };
  }

  function parseOptionalInteger(value: string, label: string): number | undefined {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive whole number.`);
    return parsed;
  }

  async function runBusy(action: () => Promise<void>): Promise<void> {
    busy = true; errorMessage = "";
    try { await action(); } catch (error) { setError(error); } finally { busy = false; }
  }
  function setError(error: unknown): void { errorMessage = error instanceof Error ? error.message : String(error); notice = "Action failed."; }
</script>

<section class="workspace-grid">
  <div class="panel profiles-panel">
    <div class="panel-heading">
      <div><h2>Connections</h2><p>{profiles.length} saved profile{profiles.length === 1 ? "" : "s"}</p></div>
      <button class="secondary compact" type="button" onclick={newProfile}>New</button>
    </div>
    <div class="profile-list">
      {#if profiles.length === 0}
        <div class="empty-state"><strong>No saved connections</strong><p>Create your first MySQL profile to begin.</p></div>
      {:else}
        {#each profiles as profile (profile.id)}
          {@const connection = openConnections.find((item) => item.profileId === profile.id)}
          <button type="button" class="profile-card" class:selected={profile.id === selectedId} onclick={() => selectProfile(profile)}>
            <span class="connection-dot" class:online={Boolean(connection)}></span>
            <span class="profile-copy">
              <strong>{profile.name}</strong>
              <span>{profile.user || "(default user)"}@{profile.host}:{profile.port ?? 3306}</span>
              <small>{profile.database ?? "All databases"} · MySQL</small>
            </span>
            <span>›</span>
          </button>
        {/each}
      {/if}
    </div>
  </div>

  <div class="panel editor-panel">
    <div class="panel-heading">
      <div><h2>{editingRevision === undefined ? "New connection" : "Connection settings"}</h2><p>Secrets are encrypted by the operating system and stored separately.</p></div>
      {#if selectedProfile?.credentialId}<span class="secure-badge">Secure secret stored</span>{/if}
    </div>

    <form onsubmit={saveProfile}>
      <div class="form-grid two">
        <label><span>Profile ID</span><input bind:value={form.id} disabled={editingRevision !== undefined} required autocomplete="off" placeholder="local-mysql" /></label>
        <label><span>Display name</span><input bind:value={form.name} required autocomplete="off" placeholder="Local MySQL" /></label>
      </div>
      <div class="form-grid host-grid">
        <label><span>Host</span><input bind:value={form.host} required autocomplete="off" placeholder="localhost" /></label>
        <label><span>Port</span><input bind:value={form.port} inputmode="numeric" placeholder="3306" /></label>
      </div>
      <div class="form-grid two">
        <label><span>User</span><input bind:value={form.user} autocomplete="username" placeholder="root" /></label>
        <label><span>Default database</span><input bind:value={form.database} autocomplete="off" placeholder="Optional" /></label>
      </div>
      <div class="form-grid two">
        <label><span>Password</span><input type="password" bind:value={form.password} autocomplete="new-password" placeholder={selectedProfile?.credentialId ? "Leave blank to keep stored password" : "Optional"} /></label>
        <label><span>Connect timeout (ms)</span><input bind:value={form.connectTimeoutMs} inputmode="numeric" placeholder="10000" /></label>
      </div>
      <label class="checkbox-row"><input type="checkbox" bind:checked={form.tlsEnabled} /> Enable TLS</label>
      {#if form.tlsEnabled}
        <div class="tls-section">
          <label class="checkbox-row"><input type="checkbox" bind:checked={form.rejectUnauthorized} /> Verify server certificate</label>
          <label><span>CA certificate</span><textarea bind:value={form.tlsCa} rows="3" placeholder="PEM certificate (optional)"></textarea></label>
          <label><span>Client certificate</span><textarea bind:value={form.tlsCert} rows="3" placeholder="PEM certificate (optional)"></textarea></label>
          <label><span>Client private key</span><textarea bind:value={form.tlsPrivateKey} rows="3" placeholder={selectedProfile?.credentialId ? "Leave blank to keep stored key" : "Stored securely"}></textarea></label>
        </div>
      {/if}
      <div class="form-actions">
        <button class="primary" type="submit" disabled={busy}>{editingRevision === undefined ? "Save connection" : "Save changes"}</button>
        {#if selectedProfile}
          {#if selectedConnection}<button class="secondary" type="button" disabled={busy} onclick={disconnectSelected}>Disconnect</button>{:else}<button class="secondary" type="button" disabled={busy} onclick={connectSelected}>Connect</button>{/if}
          {#if selectedProfile.credentialId}<button class="quiet" type="button" disabled={busy} onclick={clearCredential}>Clear secret</button>{/if}
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

<footer class="activity-bar" class:error={Boolean(errorMessage)}><span class="activity-indicator"></span><span>{errorMessage || notice}</span>{#if busy}<span class="busy">Working…</span>{/if}</footer>

<style>
  .workspace-grid{flex:1;min-height:0;display:grid;grid-template-columns:minmax(285px,.72fr) minmax(560px,1.6fr);gap:16px;padding:20px 22px}.panel{min-width:0;border:1px solid #1e3044;border-radius:11px;background:rgba(13,25,41,.86);box-shadow:0 18px 50px rgba(0,0,0,.16)}.profiles-panel{overflow:hidden}.editor-panel{padding-bottom:20px}.panel-heading{display:flex;justify-content:space-between;gap:20px;align-items:center;padding:18px 19px;border-bottom:1px solid #1b2c3f}.panel-heading h2{margin:0 0 3px;color:#eef5fd;font-size:14px}.panel-heading p{margin:0;color:#71869e;font-size:11px}.profile-list{display:grid;gap:4px;padding:9px}.profile-card{width:100%;display:grid;grid-template-columns:12px 1fr 16px;gap:10px;align-items:center;border:1px solid transparent;border-radius:8px;padding:12px 10px;background:transparent;color:inherit;text-align:left;cursor:pointer}.profile-card:hover,.profile-card.selected{border-color:#28476a;background:#12243a}.connection-dot{width:7px;height:7px;border-radius:50%;background:#495b70}.connection-dot.online{background:#40c58b;box-shadow:0 0 0 3px rgba(64,197,139,.12)}.profile-copy{min-width:0}.profile-copy strong,.profile-copy span,.profile-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.profile-copy strong{color:#dfeaf7;font-size:12px}.profile-copy span{margin-top:3px;color:#879ab1;font-size:10px}.profile-copy small{margin-top:3px;color:#5f7590;font-size:9px}.empty-state{margin:35px 18px;padding:24px 16px;border:1px dashed #2a4059;border-radius:9px;color:#8095ae;text-align:center}.empty-state strong{display:block;color:#cddbeb;font-size:12px}.empty-state p{margin:6px 0 0;font-size:10px}form{padding:20px}.form-grid{display:grid;gap:14px;margin-bottom:14px}.form-grid.two{grid-template-columns:1fr 1fr}.host-grid{grid-template-columns:1fr 120px}label>span{display:block;margin-bottom:6px;color:#8398b2;font-size:10px;font-weight:600}input,textarea{width:100%;border:1px solid #263a52;border-radius:7px;padding:9px 10px;background:#0b1726;color:#e0ebf7;outline:none}textarea{resize:vertical;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:10px}.checkbox-row{display:flex;gap:8px;align-items:center;margin:14px 0;color:#8296ad;font-size:10px}.checkbox-row input{width:auto}.tls-section{display:grid;gap:12px;margin:12px 0 17px;padding:12px;border:1px solid #20344b;border-radius:8px;background:#0c1928}.form-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding-top:8px}.secure-badge{border:1px solid #285d4b;border-radius:999px;padding:5px 8px;color:#74caa7;background:rgba(34,101,75,.14);font-size:9px}.primary,.secondary,.quiet,.danger{border-radius:7px;padding:8px 12px;cursor:pointer;font-size:10px;font-weight:650}.primary{border:1px solid #4a86dd;background:#3477d8;color:white}.secondary{border:1px solid #304966;background:#14263b;color:#bfd0e3}.secondary.compact{padding:6px 9px}.quiet{border:1px solid transparent;background:transparent;color:#7991ad}.danger{margin-left:auto;border:1px solid #60343d;background:#25151c;color:#d98a96}.connection-summary{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;margin:0 20px;overflow:hidden;border:1px solid #20364c;border-radius:8px;background:#20364c}.connection-summary div{padding:10px 12px;background:#0c1a29}.connection-summary span,.connection-summary strong{display:block}.connection-summary span{margin-bottom:3px;color:#667e99;font-size:9px;text-transform:uppercase}.connection-summary strong{color:#b9cbe0;font-size:10px}.activity-bar{min-height:29px;display:flex;gap:8px;align-items:center;padding:6px 22px;border-top:1px solid #1a2a3e;background:#091422;color:#7489a2;font-size:9px}.activity-bar.error{color:#de8995}.activity-indicator{width:6px;height:6px;border-radius:50%;background:#4d83c9}.busy{margin-left:auto}@media(max-width:1180px){.workspace-grid{grid-template-columns:300px minmax(480px,1fr)}}
</style>

<script lang="ts">
  import { onMount } from "svelte";
  import AdministrationWorkspace from "$lib/AdministrationWorkspace.svelte";
  import ConnectionsWorkspace from "$lib/ConnectionsWorkspace.svelte";
  import DatabaseExplorer from "$lib/DatabaseExplorer.svelte";
  import ErDesigner from "$lib/ErDesigner.svelte";
  import SchemaDesigner from "$lib/SchemaDesigner.svelte";
  import SqlWorkspace from "$lib/SqlWorkspace.svelte";
  import ViewDesigner from "$lib/ViewDesigner.svelte";

  type Workspace = "Developer" | "DBA" | "Architect" | "Data Engineer" | "Security";
  type Module = "connections" | "sql" | "explorer" | "schema" | "views" | "er" | "administration";

  const workspaces: readonly Workspace[] = ["Developer", "DBA", "Architect", "Data Engineer", "Security"];
  let workspace: Workspace = "Developer";
  let activeModule: Module = "connections";
  let version = "";

  $: heading = activeModule === "connections"
    ? { milestone: "M1 · Desktop SQL Development", title: "Connection workspace", description: "Manage database identities and live MySQL sessions." }
    : activeModule === "sql"
      ? { milestone: "M5 · Query Engineering", title: "SQL Editor", description: "Author, analyse, execute, explain and compare SQL against live catalogue metadata." }
      : activeModule === "explorer"
        ? { milestone: "M2 · Database Explorer", title: "Database Explorer", description: "Browse live database metadata lazily, search objects and inspect security visibility." }
        : activeModule === "schema"
          ? { milestone: "M4 · Schema Engineering", title: "Schema Designer", description: "Reverse-engineer live tables, evolve logical metadata, compare drift and apply guarded provider DDL." }
          : activeModule === "views"
            ? { milestone: "M4 · Schema Engineering", title: "View Designer", description: "Edit live view definitions while preserving provider metadata and guarded execution." }
            : activeModule === "er"
              ? { milestone: "M4 · Schema Engineering", title: "ER Designer", description: "Arrange the live entity model and create or remove guarded foreign-key relationships." }
              : { milestone: "M6 · Administration & Operations", title: "Administration", description: "Operate live MySQL sessions, locks, security, storage, data movement and provider backup hooks through guarded workflows." };

  $: phaseLabel = version.includes("-rc.") ? `RC ${version}`
    : activeModule === "administration" ? "M6 complete"
    : activeModule === "sql" ? "M5 complete"
    : activeModule === "schema" || activeModule === "views" || activeModule === "er" ? "M4 complete"
    : activeModule === "explorer" ? "M2 complete" : "M1 complete";

  onMount(() => {
    window.nublox.app.rendererReady();
    void window.nublox.app.version().then((value) => { version = value; });
  });
</script>

<svelte:head>
  <title>NuBlox SQL Workbench</title>
  <meta name="description" content="NuBlox SQL Workbench database engineering environment" />
</svelte:head>

<div class="app-shell">
  <aside class="sidebar">
    <div class="brand"><div class="brand-mark">NB</div><div><strong>NuBlox</strong><span>SQL Workbench</span></div></div>
    <label class="workspace-picker"><span>Workspace</span><select bind:value={workspace}>{#each workspaces as option}<option value={option}>{option}</option>{/each}</select></label>
    <nav aria-label="Workbench modules">
      <button class="nav-item" class:active={activeModule === "connections"} type="button" onclick={() => (activeModule = "connections")}><span class="nav-icon">◎</span>Connections</button>
      <button class="nav-item" class:active={activeModule === "sql"} type="button" onclick={() => (activeModule = "sql")}><span class="nav-icon">⌘</span>SQL Editor</button>
      <button class="nav-item" class:active={activeModule === "explorer"} type="button" onclick={() => (activeModule = "explorer")}><span class="nav-icon">◇</span>Database Explorer</button>
      <button class="nav-item" class:active={activeModule === "schema"} type="button" onclick={() => (activeModule = "schema")}><span class="nav-icon">△</span>Schema Designer<small>M4</small></button>
      <button class="nav-item" class:active={activeModule === "views"} type="button" onclick={() => (activeModule = "views")}><span class="nav-icon">▱</span>View Designer<small>M4</small></button>
      <button class="nav-item" class:active={activeModule === "er"} type="button" onclick={() => (activeModule = "er")}><span class="nav-icon">⌘</span>ER Designer<small>M4</small></button>
      <button class="nav-item" class:active={activeModule === "administration"} type="button" onclick={() => (activeModule = "administration")}><span class="nav-icon">◫</span>Administration<small>M6</small></button>
    </nav>
    <div class="sidebar-footer"><span>{workspace}</span>{#if version}<span>v{version}</span>{/if}</div>
  </aside>

  <main class="main-area">
    <header class="topbar">
      <div><p class="eyebrow">{heading.milestone}</p><h1>{heading.title}</h1><p>{heading.description}</p></div>
      <div class="phase-pill"><span></span>{phaseLabel}</div>
    </header>
    {#if activeModule === "connections"}<ConnectionsWorkspace />
    {:else if activeModule === "sql"}<SqlWorkspace />
    {:else if activeModule === "explorer"}<DatabaseExplorer />
    {:else if activeModule === "schema"}<SchemaDesigner />
    {:else if activeModule === "views"}<ViewDesigner />
    {:else if activeModule === "er"}<ErDesigner />
    {:else}<AdministrationWorkspace />{/if}
  </main>
</div>

<style>
  :global(*){box-sizing:border-box}:global(html),:global(body){margin:0;min-width:100%;min-height:100%;background:#08111f;color:#dbe7f5;font-family:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}:global(button),:global(input),:global(select),:global(textarea){font:inherit}:global(button:disabled){cursor:default;opacity:.5}.app-shell{min-height:100vh;display:grid;grid-template-columns:238px 1fr;background:radial-gradient(circle at 70% -20%,rgba(49,121,229,.12),transparent 36rem),#08111f}.sidebar{min-height:100vh;display:flex;flex-direction:column;padding:22px 15px 16px;border-right:1px solid #1d2a3b;background:rgba(10,20,35,.96)}.brand{display:flex;gap:11px;align-items:center;padding:0 7px 24px}.brand-mark{width:36px;height:36px;display:grid;place-items:center;border-radius:9px;background:linear-gradient(145deg,#4d93ff,#2863c7);color:#fff;font-weight:800;font-size:12px;letter-spacing:.04em}.brand strong,.brand span{display:block}.brand strong{color:#f5f9ff;font-size:15px}.brand span{margin-top:1px;color:#7f92aa;font-size:12px}.workspace-picker{margin:0 7px 23px}.workspace-picker>span{display:block;margin-bottom:7px;color:#7588a1;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.workspace-picker select{width:100%;border:1px solid #293a50;border-radius:8px;padding:9px 10px;background:#101c2c;color:#dbe7f5;outline:none}nav{display:grid;gap:4px}.nav-item{width:100%;display:grid;grid-template-columns:24px 1fr auto;gap:6px;align-items:center;border:0;border-radius:8px;padding:10px 9px;background:transparent;color:#92a5bc;text-align:left;cursor:pointer}.nav-item.active{background:#16263a;color:#e7f0fc}.nav-item small{color:#58718f;font-size:9px}.nav-icon{color:#629cff;text-align:center}.sidebar-footer{margin-top:auto;display:flex;justify-content:space-between;padding:14px 7px 0;border-top:1px solid #1b2a3d;color:#60748d;font-size:10px}.main-area{min-width:0;min-height:100vh;display:flex;flex-direction:column}.topbar{display:flex;justify-content:space-between;gap:30px;align-items:flex-start;padding:26px 34px 20px;border-bottom:1px solid #18283a}.eyebrow{margin:0 0 7px;color:#5795f6;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.topbar h1{margin:0 0 6px;color:#f3f7fc;font-size:25px;font-weight:670;letter-spacing:-.02em}.topbar p:last-child{margin:0;color:#8296af;font-size:13px}.phase-pill{display:flex;gap:8px;align-items:center;margin-top:4px;border:1px solid #29394d;border-radius:999px;padding:7px 11px;color:#8fa2b9;background:#0d1928;font-size:11px;white-space:nowrap}.phase-pill span{width:7px;height:7px;border-radius:50%;background:#4d83c9;box-shadow:0 0 0 3px rgba(77,131,201,.12)}@media(max-width:1180px){.app-shell{grid-template-columns:205px 1fr}}
</style>

<script lang="ts">
  import { onMount } from "svelte";
  import ConversationView from "./components/ConversationView.svelte";
  import Dialog from "./components/Dialog.svelte";
  import Home from "./components/Home.svelte";
  import ImportDialog from "./components/ImportDialog.svelte";
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import ProjectEditor from "./components/ProjectEditor.svelte";
  import ProjectView from "./components/ProjectView.svelte";
  import ProjectsView from "./components/ProjectsView.svelte";
  import SearchView from "./components/SearchView.svelte";
  import SettingsModal from "./components/SettingsModal.svelte";
  import Sidebar from "./components/Sidebar.svelte";
  import Toasts from "./components/Toasts.svelte";
  import { app, go, init, newSearch } from "./lib/state.svelte";
  import { initGoogle } from "./lib/google.svelte";

  onMount(() => {
    void initGoogle();
    void init();
    // Dropping files or folders anywhere on the window opens the importer.
    const un = getCurrentWebview().onDragDropEvent((e) => {
      const p = e.payload;
      if (p.type === "enter" || p.type === "over") app.dragging = true;
      else if (p.type === "leave") app.dragging = false;
      else if (p.type === "drop") {
        app.dragging = false;
        if (p.paths.length) app.importer = { paths: p.paths };
      }
    });
    return () => void un.then((f) => f());
  });

  function onkeydown(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === "k") {
      e.preventDefault();
      go({ name: "search" });
    } else if (k === "n" && !e.shiftKey) {
      e.preventDefault();
      newSearch(app.route.name === "project" ? app.route.id : null);
    } else if (k === ",") {
      e.preventDefault();
      app.settingsTab = "general";
      app.showSettings = true;
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="shell">
  <Sidebar />
  <main class="main">
    {#if !app.ready}
      <div class="loading"><span class="spinner"></span> Opening your library…</div>
    {:else if app.route.name === "home"}
      <Home />
    {:else if app.route.name === "chat"}
      {#key app.route.id}<ConversationView id={app.route.id} />{/key}
    {:else if app.route.name === "projects"}
      <ProjectsView />
    {:else if app.route.name === "project"}
      {#key app.route.id}<ProjectView id={app.route.id} />{/key}
    {:else if app.route.name === "search"}
      {#key `${app.route.q ?? ""}|${app.route.starred ?? false}`}
        <SearchView q={app.route.q ?? ""} starred={app.route.starred ?? false} />
      {/key}
    {/if}
  </main>
</div>

{#if app.showSettings && app.settings}<SettingsModal />{/if}
{#if app.importer}<ImportDialog />{/if}
{#if app.dragging && !app.importer}
  <div class="dropzone"><div><b>Drop to import</b><span>.md, .json and .txt exports, or folders of them</span></div></div>
{/if}
<ProjectEditor />
<Dialog />
<Toasts />

<style>
  .shell { display: flex; height: 100vh; overflow: hidden; }
  .main { flex: 1; min-width: 0; height: 100%; position: relative; }
  .dropzone { position: fixed; inset: 10px; z-index: 300; border: 2px dashed var(--accent); border-radius: 16px; background: color-mix(in srgb, var(--bg) 85%, transparent); display: grid; place-items: center; pointer-events: none; }
  .dropzone div { display: flex; flex-direction: column; align-items: center; gap: 4px; font-size: 18px; color: var(--accent); }
  .dropzone span { font-size: 13px; color: var(--text-2); }
  .loading { height: 100%; display: flex; align-items: center; justify-content: center; gap: 10px; color: var(--text-3); }
</style>

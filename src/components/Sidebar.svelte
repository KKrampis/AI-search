<script lang="ts">
  import Icon from "./Icon.svelte";
  import { app, go, newSearch, runSync } from "../lib/state.svelte";
  import { setGoogleVisible } from "../lib/google.svelte";
  import { groupByDate, relativeTime, shortcut } from "../lib/util";

  let filter = $state("");
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(t);
  });

  const visible = $derived.by(() => {
    const f = filter.trim().toLowerCase();
    const list = f ? app.recent.filter((c) => c.title.toLowerCase().includes(f)) : app.recent;
    return list.slice(0, 300);
  });
  const groups = $derived(groupByDate(visible, now));
  const activeId = $derived(app.route.name === "chat" ? app.route.id : null);
  const starredCount = $derived(app.conversations.filter((c) => c.starred).length);

  function onFilterKey(e: KeyboardEvent) {
    if (e.key === "Enter" && filter.trim()) {
      go({ name: "search", q: filter.trim() });
      filter = "";
    } else if (e.key === "Escape") filter = "";
  }

  const syncLabel = $derived.by(() => {
    if (app.sync.running) return "Syncing…";
    if (!app.syncEnabled()) return "Set up sync";
    if (app.sync.error) return "Sync failed";
    if (app.sync.lastAt) return "Synced " + relativeTime(app.sync.lastAt, now);
    return "Sync now";
  });
</script>

<aside class="sidebar">
  <div class="brand">
    <div class="logo brand-tile"><Icon name="lens" size={15} stroke={2.2} /></div>
    <span>AI<span class="thin">Search</span></span>
  </div>

  <div class="nav">
    <button class="new" onclick={() => newSearch(null)}>
      <Icon name="plus" size={15} stroke={2.4} />
      New search
      <span class="kbd">{shortcut("N")}</span>
    </button>
    <button class="nav-item" class:active={app.route.name === "search" && !app.route.starred} onclick={() => go({ name: "search" })}>
      <Icon name="search" /> Search library <span class="kbd">{shortcut("K")}</span>
    </button>
    <button class="nav-item" class:active={app.route.name === "projects" || app.route.name === "project"} onclick={() => go({ name: "projects" })}>
      <Icon name="folder" /> Projects <span class="count">{app.projects.length || ""}</span>
    </button>
    <button class="nav-item" class:active={app.route.name === "search" && app.route.starred} onclick={() => go({ name: "search", starred: true })}>
      <Icon name="star" /> Starred <span class="count">{starredCount || ""}</span>
    </button>
  </div>

  <div class="filter">
    <Icon name="search" size={13} />
    <input bind:value={filter} placeholder="Filter recents…" onkeydown={onFilterKey} />
  </div>

  <div class="recents">
    {#each groups as g (g.label)}
      <div class="group">{g.label}</div>
      {#each g.items as c (c.id)}
        <button class="conv" class:active={c.id === activeId} onclick={() => go({ name: "chat", id: c.id })} title={c.title}>
          {#if app.busy?.convId === c.id}<span class="spinner"></span>{/if}
          <span class="t">{c.title}</span>
          {#if c.starred}<Icon name="star" size={11} filled class="star" />{/if}
        </button>
      {/each}
    {:else}
      <div class="none">{filter ? "No matching titles — press Enter to search everything." : "Your searches will appear here."}</div>
    {/each}
  </div>

  <div class="footer">
    <button class="foot-btn" class:on={app.googleVisible} onclick={() => setGoogleVisible(!app.googleVisible)} title="Show or hide the Google window (sign in, solve CAPTCHAs, or watch the search)">
      <Icon name="globe" /> <span>Google window</span>
    </button>
    <div class="row">
      <button class="foot-btn grow" class:err={!!app.sync.error} onclick={() => runSync()} title={app.sync.error || app.sync.message || "Sync with GitHub / JSONBin"}>
        {#if app.sync.running}<span class="spinner"></span>{:else}<Icon name={app.sync.error ? "alert" : "cloud"} />{/if}
        <span>{syncLabel}</span>
      </button>
      <button class="icon-btn" onclick={() => { app.settingsTab = "general"; app.showSettings = true; }} title="Settings ({shortcut(',')})">
        <Icon name="settings" />
      </button>
    </div>
  </div>
</aside>

<style>
  .sidebar {
    width: var(--sidebar-w); flex: none; height: 100%;
    background: var(--bg-sidebar); border-right: 1px solid var(--border);
    display: flex; flex-direction: column; min-height: 0;
  }
  .brand { display: flex; align-items: center; gap: 9px; padding: 16px 16px 12px; font-family: var(--font-display); font-size: 16.5px; font-weight: 800; letter-spacing: -0.02em; }
  .thin { font-weight: 400; color: var(--text-2); margin-left: 1px; }
  .logo { width: 26px; height: 26px; border-radius: 8px; box-shadow: 0 2px 6px rgba(99, 102, 241, 0.3); }
  .nav { padding: 4px 8px; display: flex; flex-direction: column; gap: 1px; }
  .new {
    display: flex; align-items: center; gap: 9px; padding: 8px 10px; margin: 0 0 8px;
    border: 1px solid transparent; background: var(--accent); color: var(--accent-text);
    border-radius: var(--radius); font-weight: 600; box-shadow: 0 1px 3px rgba(13, 148, 136, 0.35);
    transition: background 0.12s;
  }
  .new:hover { background: var(--accent-hover); }
  .new .kbd { color: inherit; opacity: 0.75; border-color: currentColor; }
  .new .kbd, .nav-item .kbd { margin-left: auto; }
  .nav-item {
    display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: none; background: none;
    border-radius: var(--radius-sm); color: var(--text-2); font-size: 13.5px; text-align: left;
  }
  .nav-item:hover { background: var(--bg-hover); color: var(--text); }
  .nav-item.active { background: var(--bg-active); color: var(--accent); font-weight: 600; }
  .nav-item.active :global(.icon) { color: var(--accent); }
  .count { margin-left: auto; font-size: 12px; color: var(--text-3); }
  .filter { margin: 10px 12px 4px; display: flex; align-items: center; gap: 7px; padding: 0 9px; height: 30px; border-radius: var(--radius-sm); border: 1px solid var(--border); color: var(--text-3); background: var(--bg); }
  .filter:focus-within { border-color: var(--border-strong); }
  .filter input { border: none; outline: none; background: none; flex: 1; min-width: 0; font-size: 13px; }
  .recents { flex: 1; overflow-y: auto; padding: 4px 8px 12px; min-height: 0; }
  .group { font-size: 10.5px; font-weight: 700; color: var(--text-3); padding: 14px 10px 4px; text-transform: uppercase; letter-spacing: 0.06em; }
  .conv {
    display: flex; align-items: center; gap: 7px; width: 100%; padding: 6px 10px; border: none; background: none;
    border-radius: var(--radius-sm); font-size: 13.5px; color: var(--text); text-align: left;
  }
  .conv:hover { background: var(--bg-hover); }
  .conv { position: relative; }
  .conv.active { background: var(--bg-active); color: var(--accent); font-weight: 550; }
  .conv.active::before { content: ""; position: absolute; left: 0; top: 7px; bottom: 7px; width: 3px; border-radius: 3px; background: var(--gradient); }
  .conv .t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .conv :global(.star) { color: var(--accent); }
  .conv .spinner { width: 11px; height: 11px; }
  .none { color: var(--text-3); font-size: 12.5px; padding: 16px 10px; line-height: 1.5; }
  .footer { border-top: 1px solid var(--border); padding: 8px; display: flex; flex-direction: column; gap: 2px; }
  .foot-btn {
    display: flex; align-items: center; gap: 9px; padding: 6px 10px; border: none; background: none;
    border-radius: var(--radius-sm); color: var(--text-2); font-size: 13px; text-align: left; min-width: 0;
  }
  .foot-btn span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .foot-btn:hover { background: var(--bg-hover); color: var(--text); }
  .foot-btn.on { color: var(--accent); }
  .foot-btn.err { color: var(--danger); }
</style>

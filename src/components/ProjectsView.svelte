<script lang="ts">
  import Icon from "./Icon.svelte";
  import { app, go } from "../lib/state.svelte";
  import { relativeTime } from "../lib/util";

  let filter = $state("");
  let sort = $state<"activity" | "name">("activity");

  const stats = $derived.by(() => {
    const m = new Map<string, { count: number; last: number }>();
    for (const c of app.conversations) {
      if (!c.projectId) continue;
      const s = m.get(c.projectId) ?? { count: 0, last: 0 };
      s.count++;
      s.last = Math.max(s.last, c.updatedAt);
      m.set(c.projectId, s);
    }
    return m;
  });

  const list = $derived.by(() => {
    const f = filter.trim().toLowerCase();
    const ps = app.projects.filter((p) => !f || p.name.toLowerCase().includes(f) || p.description.toLowerCase().includes(f));
    const last = (id: string, fallback: number) => Math.max(stats.get(id)?.last ?? 0, fallback);
    return sort === "name"
      ? [...ps].sort((a, b) => a.name.localeCompare(b.name))
      : [...ps].sort((a, b) => last(b.id, b.updatedAt) - last(a.id, a.updatedAt));
  });
</script>

<div class="page">
  <div class="page-inner">
    <div class="head">
      <h1 class="page-title">Projects</h1>
      <button class="btn primary" onclick={() => (app.projectEditor = { project: null })}><Icon name="plus" size={14} /> New project</button>
    </div>
    <p class="muted sub">Group related searches, give them shared instructions, and find them again later. Each project is a folder in your library.</p>

    <div class="tools">
      <div class="search">
        <Icon name="search" size={14} />
        <input bind:value={filter} placeholder="Search projects…" />
      </div>
      <select class="select sort" bind:value={sort}>
        <option value="activity">Recent activity</option>
        <option value="name">Name</option>
      </select>
    </div>

    {#if list.length}
      <div class="grid">
        {#each list as p (p.id)}
          {@const s = stats.get(p.id)}
          <button class="card" onclick={() => go({ name: "project", id: p.id })}>
            <div class="name"><Icon name="folder" size={15} /> {p.name}</div>
            <div class="desc">{p.description || "No description"}</div>
            <div class="meta">{s?.count ?? 0} search{s?.count === 1 ? "" : "es"} · updated {relativeTime(Math.max(s?.last ?? 0, p.updatedAt))}</div>
          </button>
        {/each}
      </div>
    {:else}
      <div class="empty">
        {#if filter}No projects match “{filter}”.{:else}No projects yet. Create one to organise your searches.{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .sub { margin: 4px 0 22px; }
  .tools { display: flex; gap: 10px; margin-bottom: 18px; }
  .search { flex: 1; display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 38px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg-input); color: var(--text-3); }
  .search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
  .search input { flex: 1; border: none; outline: none; background: none; font-size: 14px; color: var(--text); }
  .sort { width: 170px; height: 38px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; }
  .card { text-align: left; display: flex; flex-direction: column; gap: 6px; padding: 16px; min-height: 120px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg-elev); transition: border-color 0.12s, box-shadow 0.12s; }
  .card { border-top: 2px solid transparent; }
  .card:hover { border-color: var(--border-strong); border-top-color: var(--accent); box-shadow: var(--shadow); }
  .name { font-weight: 650; font-size: 15px; display: flex; align-items: center; gap: 8px; }
  .name :global(.icon) { color: var(--accent); }
  .desc { color: var(--text-2); font-size: 13px; flex: 1; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .meta { color: var(--text-3); font-size: 12px; }
</style>

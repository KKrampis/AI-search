<script lang="ts">
  import ConvRow from "./ConvRow.svelte";
  import Icon from "./Icon.svelte";
  import { app } from "../lib/state.svelte";
  import type { Conversation } from "../lib/types";

  let { q = "", starred = false }: { q?: string; starred?: boolean } = $props();

  let query = $state("");
  let onlyStarred = $state(false);
  let projectFilter = $state<string>("all"); // all | none | <id>
  let sort = $state<"relevance" | "recent" | "oldest">("relevance");
  let input: HTMLInputElement;

  $effect(() => {
    query = q;
    onlyStarred = starred;
    input?.focus();
  });

  const results = $derived.by(() => {
    void app.indexVersion;
    const text = query.trim();
    const keep = (c: Conversation) =>
      (!onlyStarred || c.starred) &&
      (projectFilter === "all" || (projectFilter === "none" ? !c.projectId : c.projectId === projectFilter));
    if (!text) {
      const list = app.recent.filter(keep);
      return { list: sort === "oldest" ? [...list].reverse() : list, snippets: new Map<string, string>() };
    }
    const byId = new Map(app.conversations.map((c) => [c.id, c]));
    const hits = app.index.search(text).filter((h) => byId.has(h.id) && keep(byId.get(h.id)!));
    let list = hits.map((h) => byId.get(h.id)!);
    if (sort === "recent") list = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
    if (sort === "oldest") list = [...list].sort((a, b) => a.updatedAt - b.updatedAt);
    return { list, snippets: new Map(hits.map((h) => [h.id, h.snippet])) };
  });
</script>

<div class="page">
  <div class="page-inner">
    <h1 class="page-title">{onlyStarred && !query ? "Starred" : "Search your library"}</h1>
    <div class="box">
      <Icon name="search" size={17} />
      <input bind:this={input} bind:value={query} placeholder="Search titles, questions, answers, tags and projects…" />
      {#if query}<button class="icon-btn" onclick={() => (query = "")} aria-label="Clear"><Icon name="x" size={14} /></button>{/if}
    </div>
    <div class="filters">
      <select class="select" bind:value={projectFilter}>
        <option value="all">All projects</option>
        <option value="none">No project</option>
        {#each app.sortedProjects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
      <select class="select" bind:value={sort}>
        <option value="relevance">{query ? "Best match" : "Most recent"}</option>
        <option value="recent">Most recent</option>
        <option value="oldest">Oldest</option>
      </select>
      <label class="toggle"><input type="checkbox" bind:checked={onlyStarred} /> Starred only</label>
      <span class="count">{results.list.length} result{results.list.length === 1 ? "" : "s"}</span>
    </div>

    <div class="results">
      {#each results.list as c (c.id)}
        <ConvRow conv={c} snippet={results.snippets.get(c.id)} />
      {:else}
        <div class="empty">
          {#if query}No searches match “{query}”. Matching is fuzzy and prefix-based — try fewer or shorter words.
          {:else if onlyStarred}Nothing starred yet. Star a search to keep it handy.
          {:else}Your library is empty — run a search first.{/if}
        </div>
      {/each}
    </div>
  </div>
</div>

<style>
  .box { display: flex; align-items: center; gap: 10px; margin-top: 16px; height: 48px; padding: 0 10px 0 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--bg-input); box-shadow: var(--shadow); color: var(--text-3); }
  .box:focus-within { border-color: var(--accent); box-shadow: var(--shadow), 0 0 0 3px var(--accent-soft); }
  .box input { flex: 1; border: none; outline: none; background: none; font-size: 15.5px; color: var(--text); }
  .filters { display: flex; align-items: center; gap: 8px; margin: 14px 0 10px; flex-wrap: wrap; }
  .filters .select { width: auto; height: 32px; padding: 0 8px; font-size: 13px; }
  .toggle { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-2); cursor: pointer; }
  .toggle input { accent-color: var(--accent); }
  .count { margin-left: auto; font-size: 12.5px; color: var(--text-3); }
  .results { border-top: 1px solid var(--border); }
</style>

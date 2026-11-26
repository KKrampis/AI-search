<script lang="ts">
  import Composer from "./Composer.svelte";
  import ConvRow from "./ConvRow.svelte";
  import Icon from "./Icon.svelte";
  import { app, deleteProject, go } from "../lib/state.svelte";
  import { startConversation } from "../lib/google.svelte";

  let { id }: { id: string } = $props();
  const project = $derived(app.project(id));
  let filter = $state("");

  const convs = $derived.by(() => {
    void app.indexVersion;
    const inProject = app.recent.filter((c) => c.projectId === id);
    const f = filter.trim();
    if (!f) return { list: inProject, snippets: new Map<string, string>() };
    const hits = app.index.search(f).filter((h) => inProject.some((c) => c.id === h.id));
    return {
      list: hits.map((h) => inProject.find((c) => c.id === h.id)!),
      snippets: new Map(hits.map((h) => [h.id, h.snippet])),
    };
  });
</script>

{#if project}
  <div class="page">
    <div class="page-inner">
      <button class="back" onclick={() => go({ name: "projects" })}><Icon name="chevron-right" size={13} class="flip" /> All projects</button>
      <div class="head">
        <h1 class="page-title">{project.name}</h1>
        <div class="row">
          <button class="btn" onclick={() => (app.projectEditor = { project })}><Icon name="edit" size={14} /> Edit</button>
          <button class="btn danger" onclick={() => deleteProject(project.id)}><Icon name="trash" size={14} /> Delete</button>
        </div>
      </div>
      {#if project.description}<p class="desc">{project.description}</p>{/if}
      {#if project.instructions}
        <div class="instr"><b>Instructions</b> — {project.instructions}</div>
      {/if}

      <div class="composer">
        <Composer onsubmit={(t) => startConversation(t, project.id)} blocked={!!app.busy} placeholder={`Start a new search in ${project.name}…`} />
      </div>

      <div class="list-head">
        <span>{convs.list.length} search{convs.list.length === 1 ? "" : "es"}</span>
        <div class="search">
          <Icon name="search" size={13} />
          <input bind:value={filter} placeholder="Search in this project…" />
        </div>
      </div>
      {#each convs.list as c (c.id)}
        <ConvRow conv={c} snippet={convs.snippets.get(c.id)} showProject={false} />
      {:else}
        <div class="empty">{filter ? "Nothing matches." : "No searches in this project yet."}</div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .back { border: none; background: none; color: var(--text-3); font-size: 13px; display: inline-flex; align-items: center; gap: 4px; padding: 4px 6px 4px 2px; margin-bottom: 8px; border-radius: 6px; }
  .back:hover { color: var(--text); background: var(--bg-hover); }
  .back :global(.flip) { transform: rotate(180deg); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .desc { color: var(--text-2); margin: 6px 0 0; font-size: 14.5px; }
  .instr { margin-top: 12px; padding: 10px 13px; border-radius: var(--radius-sm); background: var(--accent-soft); font-size: 13px; color: var(--text-2); }
  .instr b { color: var(--text); font-weight: 600; }
  .composer { margin: 24px 0 28px; }
  .list-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid var(--border); font-size: 13px; font-weight: 600; color: var(--text-2); }
  .search { display: flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); color: var(--text-3); background: var(--bg-input); width: 260px; }
  .search:focus-within { border-color: var(--accent); }
  .search input { border: none; outline: none; background: none; flex: 1; min-width: 0; font-weight: 400; font-size: 13px; color: var(--text); }
</style>

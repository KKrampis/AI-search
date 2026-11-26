<script lang="ts">
  import Menu from "./Menu.svelte";
  import Icon from "./Icon.svelte";
  import { app } from "../lib/state.svelte";

  let {
    value,
    onchange,
    up = false,
    compact = false,
    convId,
  }: {
    value: string | null | undefined;
    onchange: (id: string | null) => void;
    up?: boolean;
    compact?: boolean;
    /** When creating a project from here, move this conversation into it. */
    convId?: string;
  } = $props();

  const current = $derived(app.project(value));
</script>

<Menu {up} width={240}>
  {#snippet trigger(toggle)}
    <button class="chip picker" class:compact onclick={toggle} title="Project">
      <Icon name="folder" size={13} />
      <span class="name">{current ? current.name : "No project"}</span>
      <Icon name="chevron-down" size={12} />
    </button>
  {/snippet}
  {#snippet children(close)}
    <div class="menu-head">Save to project</div>
    <button class="menu-item" class:active={!value} onclick={() => { onchange(null); close(); }}>
      <Icon name="message" size={14} /><span class="label">No project</span>
      {#if !value}<Icon name="check" size={14} />{/if}
    </button>
    {#each app.sortedProjects as p (p.id)}
      <button class="menu-item" class:active={value === p.id} onclick={() => { onchange(p.id); close(); }}>
        <Icon name="folder" size={14} /><span class="label">{p.name}</span>
        {#if value === p.id}<Icon name="check" size={14} />{/if}
      </button>
    {/each}
    <div class="menu-sep"></div>
    <button class="menu-item" onclick={() => { close(); app.projectEditor = { project: null, thenMove: convId }; }}>
      <Icon name="plus" size={14} /><span class="label">New project…</span>
    </button>
  {/snippet}
</Menu>

<style>
  .picker { cursor: pointer; }
  .picker:hover { background: var(--bg-hover); color: var(--text); }
  .name { overflow: hidden; text-overflow: ellipsis; max-width: 200px; }
  .compact .name { max-width: 140px; }
</style>

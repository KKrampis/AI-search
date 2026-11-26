<script lang="ts">
  import Icon from "./Icon.svelte";
  import { app, go, toggleStar } from "../lib/state.svelte";
  import type { Conversation } from "../lib/types";
  import { relativeTime, stripMarkdown, truncate } from "../lib/util";

  let { conv, snippet, showProject = true }: { conv: Conversation; snippet?: string; showProject?: boolean } = $props();

  const project = $derived(showProject ? app.project(conv.projectId) : undefined);
  const preview = $derived.by(() => {
    if (snippet) return null;
    const a = conv.messages.find((m) => m.role === "assistant" && m.content);
    return a ? truncate(stripMarkdown(a.content), 200) : "";
  });
  const turns = $derived(conv.messages.filter((m) => m.role === "user").length);
</script>

<div class="row-item">
  <button class="main" onclick={() => go({ name: "chat", id: conv.id })}>
    <div class="top">
      <span class="t">{conv.title}</span>
      {#if project}<span class="chip"><Icon name="folder" size={11} />{project.name}</span>{/if}
    </div>
    {#if snippet}
      <!-- snippet is escaped HTML with <mark> highlights (search.ts) -->
      <div class="snip">{@html snippet}</div>
    {:else if preview}
      <div class="snip">{preview}</div>
    {/if}
    <div class="meta">{relativeTime(conv.updatedAt)} · {turns} question{turns === 1 ? "" : "s"}</div>
  </button>
  <button class="icon-btn star" class:on={conv.starred} onclick={() => toggleStar(conv)} title={conv.starred ? "Unstar" : "Star"}>
    <Icon name="star" size={15} filled={conv.starred} />
  </button>
</div>

<style>
  .row-item { display: flex; align-items: flex-start; gap: 4px; border-bottom: 1px solid var(--border); }
  .main { flex: 1; min-width: 0; text-align: left; border: none; background: none; padding: 13px 10px; border-radius: var(--radius-sm); margin: 2px 0; }
  .main:hover { background: var(--bg-hover); }
  .top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .t { font-weight: 600; font-size: 14.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .snip { color: var(--text-2); font-size: 13px; margin-top: 4px; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .meta { color: var(--text-3); font-size: 12px; margin-top: 5px; }
  .star { margin-top: 12px; opacity: 0.5; }
  .row-item:hover .star, .star.on { opacity: 1; }
</style>

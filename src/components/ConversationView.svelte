<script lang="ts">
  import { save as saveDialog } from "@tauri-apps/plugin-dialog";
  import Composer from "./Composer.svelte";
  import Icon from "./Icon.svelte";
  import Menu from "./Menu.svelte";
  import MessageView from "./MessageView.svelte";
  import ProjectPicker from "./ProjectPicker.svelte";
  import { api, errorText } from "../lib/api";
  import { app, deleteConversation, go, moveConversation, renameConversation, toast, toggleStar } from "../lib/state.svelte";
  import { ask, setGoogleVisible, stop } from "../lib/google.svelte";
  import { slug } from "../lib/slug";

  let { id }: { id: string } = $props();
  const conv = $derived(app.conv(id));
  const project = $derived(app.project(conv?.projectId));
  const busyHere = $derived(app.busy?.convId === id);

  let scroller: HTMLDivElement | undefined = $state();
  let editing = $state(false);
  let titleDraft = $state("");
  let stick = true;

  // Keep the view pinned to the bottom while an answer streams in,
  // unless the user scrolled up to read.
  function onscroll() {
    if (!scroller) return;
    stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80;
  }
  $effect(() => {
    // Track content changes of the last message.
    const last = conv?.messages[conv.messages.length - 1];
    void last?.content;
    void last?.status;
    void conv?.messages.length;
    if (stick && scroller) queueMicrotask(() => scroller && (scroller.scrollTop = scroller.scrollHeight));
  });
  $effect(() => {
    void id;
    stick = true;
    editing = false;
    queueMicrotask(() => scroller && (scroller.scrollTop = scroller.scrollHeight));
  });

  function startEdit() {
    if (!conv) return;
    titleDraft = conv.title;
    editing = true;
  }
  async function commitEdit() {
    editing = false;
    if (conv) await renameConversation(conv, titleDraft);
  }

  async function exportMd() {
    if (!conv) return;
    try {
      const path = await saveDialog({ defaultPath: `${slug(conv.title)}.md`, filters: [{ name: "Markdown", extensions: ["md"] }] });
      if (!path) return;
      await api.exportConversation(conv.id, path);
      toast("Exported", "success");
    } catch (e) {
      toast("Export failed: " + errorText(e), "error");
    }
  }

  async function copyAll() {
    if (!conv) return;
    const text = conv.messages
      .map((m) => (m.role === "user" ? `## ${m.content}` : m.content + (m.sources?.length ? "\n\nSources:\n" + m.sources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}`).join("\n") : "")))
      .join("\n\n");
    await navigator.clipboard.writeText(text);
    toast("Conversation copied", "success", undefined, 1800);
  }

  function send(text: string) {
    if (conv) void ask(conv, text);
  }
</script>

{#if conv}
  <div class="chat">
    <header class="head">
      <div class="title-wrap">
        {#if project}
          <button class="crumb" onclick={() => go({ name: "project", id: project.id })}>{project.name}</button>
          <span class="slash">/</span>
        {/if}
        {#if editing}
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="title-input"
            bind:value={titleDraft}
            autofocus
            onblur={commitEdit}
            onkeydown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") editing = false; }}
          />
        {:else}
          <button class="title" onclick={startEdit} title="Rename">{conv.title}</button>
        {/if}
      </div>
      <div class="tools">
        <ProjectPicker value={conv.projectId} onchange={(pid) => moveConversation(conv, pid)} convId={conv.id} compact />
        <button class="icon-btn" class:on={conv.starred} onclick={() => toggleStar(conv)} title={conv.starred ? "Unstar" : "Star"}>
          <Icon name="star" filled={conv.starred} />
        </button>
        <Menu align="right" width={230}>
          {#snippet trigger(toggle)}
            <button class="icon-btn" onclick={toggle} title="More"><Icon name="more" size={18} stroke={2.6} /></button>
          {/snippet}
          {#snippet children(close)}
            <button class="menu-item" onclick={() => { close(); startEdit(); }}><Icon name="edit" size={14} /><span class="label">Rename</span></button>
            <button class="menu-item" onclick={() => { close(); void exportMd(); }}><Icon name="download" size={14} /><span class="label">Export as Markdown…</span></button>
            <button class="menu-item" onclick={() => { close(); void copyAll(); }}><Icon name="copy" size={14} /><span class="label">Copy conversation</span></button>
            {#if conv.googleUrl}
              <button class="menu-item" onclick={() => { close(); void api.openUrl(conv.googleUrl!); }}><Icon name="external" size={14} /><span class="label">Open in browser</span></button>
            {/if}
            <button class="menu-item" onclick={() => { close(); void setGoogleVisible(true); }}><Icon name="globe" size={14} /><span class="label">Show Google window</span></button>
            <div class="menu-sep"></div>
            <button class="menu-item danger" onclick={() => { close(); void deleteConversation(conv.id); }}><Icon name="trash" size={14} /><span class="label">Delete</span></button>
          {/snippet}
        </Menu>
      </div>
    </header>

    <div class="scroll" bind:this={scroller} {onscroll}>
      <div class="thread">
        {#each conv.messages as m, i (m.id)}
          <MessageView message={m} {conv} last={i === conv.messages.length - 1} />
        {/each}
      </div>
    </div>

    <div class="dock">
      <Composer
        onsubmit={send}
        onstop={stop}
        busy={busyHere}
        blocked={!!app.busy && !busyHere}
        autofocus
        placeholder="Ask a follow-up…"
      />
      <div class="disclaimer">Answers come from Google AI Mode and can be wrong — check the sources.</div>
    </div>
  </div>
{:else}
  <div class="empty">This search no longer exists.</div>
{/if}

<style>
  .chat { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 16px 10px 24px; border-bottom: 1px solid transparent; flex: none; }
  .title-wrap { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1; }
  .crumb { border: none; background: none; padding: 4px 6px; border-radius: 6px; color: var(--text-3); font-size: 14px; white-space: nowrap; }
  .crumb:hover { background: var(--bg-hover); color: var(--text); }
  .slash { color: var(--text-3); }
  .title { border: none; background: none; padding: 4px 8px; border-radius: 6px; font-size: 14.5px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; text-align: left; }
  .title:hover { background: var(--bg-hover); }
  .title-input { flex: 1; font-size: 14.5px; font-weight: 550; padding: 3px 7px; border: 1px solid var(--accent); border-radius: 6px; outline: none; background: var(--bg-input); }
  .tools { display: flex; align-items: center; gap: 4px; flex: none; }
  .scroll { flex: 1; overflow-y: auto; min-height: 0; }
  .thread { max-width: 780px; margin: 0 auto; padding: 8px 28px 40px; }
  /* No divider above the first question. */
  .thread > :global(.user:first-child) { border-top: none; padding-top: 0; margin-top: 22px; }
  .dock { flex: none; max-width: 780px; width: 100%; margin: 0 auto; padding: 0 28px 14px; }
  .disclaimer { text-align: center; font-size: 11.5px; color: var(--text-3); margin-top: 7px; }
</style>

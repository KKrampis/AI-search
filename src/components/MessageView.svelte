<script lang="ts">
  import Icon from "./Icon.svelte";
  import { renderMarkdown } from "../lib/markdown";
  import { api } from "../lib/api";
  import { app, toast } from "../lib/state.svelte";
  import { ask, openSelectorSettings, saveGoogleSnapshot, setGoogleVisible, stop } from "../lib/google.svelte";
  import { domainOf } from "../lib/util";
  import type { Conversation, Message } from "../lib/types";

  let { message, conv, last = false }: { message: Message; conv: Conversation; last?: boolean } = $props();

  let showAllSources = $state(false);
  let showSent = $state(false);
  const html = $derived(message.role === "assistant" ? renderMarkdown(message.content) : "");
  const running = $derived(app.busy?.msgId === message.id);
  const sources = $derived(message.sources ?? []);
  const shownSources = $derived(showAllSources ? sources : sources.slice(0, 6));

  function onclick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute("href") ?? "";
    if (/^https?:/i.test(href)) void api.openUrl(href);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(message.content);
      toast("Copied as Markdown", "success", undefined, 1800);
    } catch {
      toast("Clipboard unavailable", "error");
    }
  }

  function retry() {
    void ask(conv, "retry", { retryMsgId: message.id });
  }
</script>

{#if message.role === "user"}
  <div class="user">
    <div class="q-icon"><Icon name="search" size={14} stroke={2.2} /></div>
    <div class="bubble">
      {message.content}
      {#if message.sent}
        <button class="sent-toggle" onclick={() => (showSent = !showSent)}>{showSent ? "Hide" : "Show"} what was sent to Google</button>
        {#if showSent}<pre class="sent">{message.sent}</pre>{/if}
      {/if}
    </div>
  </div>
{:else}
  <div class="bot">
    <div class="avatar brand-tile"><Icon name="lens" size={14} stroke={2.2} /></div>
    <div class="body">
      {#if message.content}
        <!-- Links are opened in the system browser. -->
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="prose" {onclick}>{@html html}</div>
      {/if}

      {#if running || message.status === "pending"}
        <div class="status">
          <span class="spinner"></span>
          <span class="dots">{message.content ? "Writing" : "Searching Google AI Mode"}</span>
          <button class="btn ghost sm" onclick={() => setGoogleVisible(true)}><Icon name="eye" size={13} /> Watch</button>
          <button class="btn ghost sm" onclick={stop}><Icon name="stop" size={11} filled /> Stop</button>
        </div>
      {:else if message.status === "needs_user"}
        <div class="notice warn">
          <Icon name="alert" size={15} />
          <div class="grow">{message.note}</div>
          <button class="btn sm" onclick={() => setGoogleVisible(true)}>Open Google window</button>
        </div>
      {:else if message.status === "error" || message.status === "stopped"}
        <div class="notice" class:err={message.status === "error"}>
          <Icon name="alert" size={15} />
          <div class="grow">{message.note || (message.status === "stopped" ? "Stopped." : "Something went wrong.")}</div>
          <button class="btn sm" onclick={retry} disabled={!!app.busy}><Icon name="refresh" size={13} /> Retry</button>
          {#if /user agent|basic page/i.test(message.note ?? "")}
            <button class="btn sm ghost" onclick={openSelectorSettings}>Google settings</button>
          {:else}
            <button class="btn sm ghost" onclick={() => setGoogleVisible(true)}>Google window</button>
          {/if}
        </div>
      {:else if message.note && /generic fallback|container not found/i.test(message.note)}
        <div class="notice warn fallback">
          <Icon name="alert" size={15} />
          <div class="grow">
            Google's page layout wasn't recognised, so this answer was captured with a generic method and may include extra
            text from the page.
          </div>
          <button class="btn sm" onclick={saveGoogleSnapshot} title="Saves the current Google page so the selectors can be fixed">Save page snapshot</button>
          <button class="btn sm ghost" onclick={openSelectorSettings}>Selector settings</button>
        </div>
      {:else if message.note}
        <div class="note">{message.note}</div>
      {/if}

      {#if sources.length}
        <div class="sources">
          <div class="src-head">{sources.length} source{sources.length === 1 ? "" : "s"}</div>
          <div class="src-list">
            {#each shownSources as s, i (s.url + i)}
              <button class="src" onclick={() => api.openUrl(s.url)} title={s.url}>
                <span class="n">{i + 1}</span>
                <span class="st">{s.title}</span>
                <span class="sd">{domainOf(s.url)}</span>
              </button>
            {/each}
            {#if sources.length > 6}
              <button class="src more" onclick={() => (showAllSources = !showAllSources)}>
                {showAllSources ? "Show fewer" : `+${sources.length - 6} more`}
              </button>
            {/if}
          </div>
        </div>
      {/if}

      {#if message.content && !running}
        <div class="actions">
          <button class="icon-btn" onclick={copy} title="Copy as Markdown"><Icon name="copy" size={14} /></button>
          {#if last}
            <button class="icon-btn" onclick={retry} title="Ask again" disabled={!!app.busy}><Icon name="refresh" size={14} /></button>
          {/if}
          {#if message.status === "partial"}<span class="partial">answer may be incomplete</span>{/if}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* The question reads as a heading for the answer below it. */
  .user { display: flex; align-items: flex-start; gap: 12px; margin: 34px 0 14px; padding-top: 22px; border-top: 1px solid var(--border); }
  .q-icon { width: 26px; height: 26px; border-radius: 8px; flex: none; display: grid; place-items: center; color: var(--accent); background: var(--accent-soft); margin-top: 2px; }
  .bubble {
    flex: 1; min-width: 0; font-family: var(--font-display); font-size: 19px; font-weight: 650; letter-spacing: -0.015em;
    line-height: 1.35; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--text); padding-top: 1px;
  }
  .sent-toggle { display: block; margin-top: 6px; border: none; background: none; padding: 0; font-family: var(--font); font-size: 11.5px; font-weight: 400; letter-spacing: 0; color: var(--text-3); text-decoration: underline; }
  .sent { margin: 6px 0 0; font-family: var(--font-mono); font-size: 12px; font-weight: 400; letter-spacing: 0; white-space: pre-wrap; color: var(--text-2); }
  .bot { display: flex; gap: 12px; margin-bottom: 8px; }
  .avatar { width: 26px; height: 26px; border-radius: 8px; flex: none; margin-top: 2px; }
  .body { flex: 1; min-width: 0; }
  .status { display: flex; align-items: center; gap: 8px; color: var(--text-2); font-size: 13.5px; margin-top: 8px; min-height: 30px; }
  .status .btn { margin-left: 2px; }
  .status .btn:first-of-type { margin-left: auto; }
  .notice { display: flex; align-items: flex-start; gap: 10px; margin-top: 10px; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--bg-hover); color: var(--text-2); font-size: 13px; line-height: 1.45; }
  .notice :global(.icon) { margin-top: 1px; }
  .notice.warn { background: rgba(168, 107, 0, 0.1); color: var(--text); }
  .notice.warn > :global(.icon) { color: var(--warn); }
  .notice.err > :global(.icon) { color: var(--danger); }
  .note { margin-top: 8px; font-size: 12.5px; color: var(--text-3); font-style: italic; }
  .sources { margin-top: 16px; }
  .src-head { font-size: 10.5px; font-weight: 700; color: var(--text-3); margin-bottom: 7px; text-transform: uppercase; letter-spacing: 0.06em; }
  .src-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 6px; }
  .src {
    display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 8px; text-align: left;
    padding: 7px 10px; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-elev); min-width: 0;
  }
  .src:hover { border-color: var(--accent); }
  .n { grid-row: span 2; font-size: 11px; font-weight: 600; color: var(--accent); background: var(--accent-soft); border-radius: 5px; min-width: 18px; height: 18px; display: grid; place-items: center; margin-top: 1px; }
  .st { font-size: 12.5px; font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sd { font-size: 11.5px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .src.more { display: flex; align-items: center; justify-content: center; color: var(--text-2); font-size: 12.5px; }
  .actions { display: flex; align-items: center; gap: 2px; margin-top: 8px; margin-left: -6px; }
  .actions .icon-btn { width: 28px; height: 28px; }
  .partial { font-size: 12px; color: var(--warn); margin-left: 6px; }
</style>

<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  let {
    placeholder = "Ask Google AI Mode…",
    onsubmit,
    onstop,
    busy = false,
    blocked = false,
    autofocus = false,
    hero = false,
    footer,
  }: {
    placeholder?: string;
    onsubmit: (text: string) => void;
    onstop?: () => void;
    /** A search is running in *this* conversation. */
    busy?: boolean;
    /** A search is running elsewhere. */
    blocked?: boolean;
    autofocus?: boolean;
    hero?: boolean;
    footer?: Snippet;
  } = $props();

  let text = $state("");
  let ta: HTMLTextAreaElement;

  function resize() {
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, hero ? 320 : 240) + "px";
  }

  function submit() {
    const t = text.trim();
    if (!t || busy || blocked) return;
    onsubmit(t);
    text = "";
    queueMicrotask(resize);
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      submit();
    }
  }

  $effect(() => {
    if (autofocus) ta?.focus();
  });

  export function focus() {
    ta?.focus();
  }
</script>

<div class="composer" class:hero>
  <textarea
    bind:this={ta}
    bind:value={text}
    {placeholder}
    rows={hero ? 3 : 1}
    oninput={resize}
    {onkeydown}
    spellcheck="true"
  ></textarea>
  <div class="bar">
    <div class="left">{@render footer?.()}</div>
    <div class="right">
      {#if blocked && !busy}<span class="hint">Another search is running…</span>{/if}
      {#if busy}
        <button class="send stop" onclick={() => onstop?.()} title="Stop">
          <Icon name="stop" size={14} filled />
        </button>
      {:else}
        <button class="send" onclick={submit} disabled={!text.trim() || blocked} title="Send (Enter)">
          <Icon name="arrow-up" size={16} stroke={2.2} />
        </button>
      {/if}
    </div>
  </div>
</div>

<style>
  .composer {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow);
    padding: 12px 12px 10px 16px;
    transition: border-color 0.12s, box-shadow 0.12s;
  }
  .composer:focus-within { border-color: var(--accent); box-shadow: var(--shadow), 0 0 0 4px var(--accent-soft); }
  textarea {
    width: 100%; border: none; outline: none; resize: none; background: transparent;
    font-size: 15px; line-height: 1.5; max-height: 240px; padding: 2px 0; display: block;
  }
  .hero textarea { font-size: 16px; min-height: 72px; max-height: 320px; }
  textarea::placeholder { color: var(--text-3); }
  .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; }
  .left, .right { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .hint { font-size: 12px; color: var(--text-3); }
  .send {
    width: 34px; height: 34px; border-radius: 50%; border: none;
    display: grid; place-items: center;
    background: var(--gradient); color: var(--on-gradient);
    transition: filter 0.12s, opacity 0.12s, transform 0.12s;
  }
  .send:hover:not(:disabled) { filter: brightness(1.08); transform: translateY(-1px); }
  .send:disabled { opacity: 0.35; cursor: default; }
  .send.stop { background: var(--text); color: var(--bg); }
</style>

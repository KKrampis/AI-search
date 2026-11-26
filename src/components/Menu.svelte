<script lang="ts">
  import type { Snippet } from "svelte";

  let {
    trigger,
    children,
    align = "left",
    up = false,
    width = 220,
  }: {
    trigger: Snippet<[toggle: () => void, open: boolean]>;
    children: Snippet<[close: () => void]>;
    align?: "left" | "right";
    up?: boolean;
    width?: number;
  } = $props();

  let open = $state(false);
  let wrap: HTMLDivElement;

  const toggle = () => (open = !open);
  const close = () => (open = false);

  $effect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap && !wrap.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  });
</script>

<div class="menu-wrap" bind:this={wrap}>
  {@render trigger(toggle, open)}
  {#if open}
    <div class="menu" class:right={align === "right"} class:up style:width="{width}px" role="menu">
      {@render children(close)}
    </div>
  {/if}
</div>

<style>
  .menu-wrap { position: relative; display: inline-flex; }
  .menu {
    position: absolute; top: calc(100% + 4px); left: 0; z-index: 50;
    background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius);
    box-shadow: var(--shadow-lg); padding: 5px; max-height: 360px; overflow-y: auto;
  }
  .menu.right { left: auto; right: 0; }
  .menu.up { top: auto; bottom: calc(100% + 4px); }
  .menu :global(.menu-item) {
    display: flex; align-items: center; gap: 9px; width: 100%;
    padding: 7px 9px; border: none; background: none; border-radius: 6px;
    text-align: left; font-size: 13px; color: var(--text);
  }
  .menu :global(.menu-item:hover) { background: var(--bg-hover); }
  .menu :global(.menu-item.danger) { color: var(--danger); }
  .menu :global(.menu-item.active) { color: var(--accent); font-weight: 600; }
  .menu :global(.menu-item .label) { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .menu :global(.menu-sep) { height: 1px; background: var(--border); margin: 4px 2px; }
  .menu :global(.menu-head) { font-size: 11px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; padding: 6px 9px 3px; }
</style>

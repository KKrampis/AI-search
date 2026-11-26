<script lang="ts">
  import Icon from "./Icon.svelte";
  import { app, dismissToast } from "../lib/state.svelte";

  const icon = { info: "sparkle", success: "check", error: "alert", warn: "alert" } as const;
</script>

<div class="toasts" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <div class="toast {t.kind}">
      <Icon name={icon[t.kind]} size={15} />
      <span class="text">{t.text}</span>
      {#if t.action}
        <button class="btn sm" onclick={() => { t.action?.run(); dismissToast(t.id); }}>{t.action.label}</button>
      {/if}
      <button class="icon-btn" onclick={() => dismissToast(t.id)} aria-label="Dismiss"><Icon name="x" size={13} /></button>
    </div>
  {/each}
</div>

<style>
  .toasts { position: fixed; right: 16px; bottom: 16px; display: flex; flex-direction: column; gap: 8px; z-index: 200; max-width: min(440px, calc(100vw - 32px)); }
  .toast {
    display: flex; align-items: flex-start; gap: 9px; padding: 10px 6px 10px 12px;
    background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius);
    box-shadow: var(--shadow-lg); font-size: 13px; animation: slide 0.18s ease-out;
  }
  .toast > :global(.icon:first-child) { margin-top: 2px; }
  .text { flex: 1; white-space: pre-line; overflow-wrap: anywhere; padding-top: 1px; }
  .toast .icon-btn { width: 24px; height: 24px; }
  .success > :global(.icon:first-child) { color: var(--success); }
  .error > :global(.icon:first-child) { color: var(--danger); }
  .warn > :global(.icon:first-child) { color: var(--warn); }
  .info > :global(.icon:first-child) { color: var(--accent); }
  @keyframes slide { from { transform: translateY(8px); opacity: 0; } }
</style>

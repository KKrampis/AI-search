<script lang="ts">
  import { app, closeDialog } from "../lib/state.svelte";

  const d = $derived(app.dialog);

  function onkeydown(e: KeyboardEvent) {
    if (!d) return;
    if (e.key === "Escape") closeDialog(null);
  }
</script>

<svelte:window {onkeydown} />

{#if d}
  <div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && closeDialog(null)}>
    <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
      <h2 id="dlg-title">{d.title}</h2>
      <p>{d.message}</p>
      <div class="buttons">
        {#each d.buttons as b, i (b.value)}
          <!-- svelte-ignore a11y_autofocus -->
          <button
            class="btn"
            class:primary={b.kind === "primary"}
            class:danger={b.kind === "danger"}
            class:solid={b.kind === "danger"}
            autofocus={i === d.buttons.length - 1}
            onclick={() => closeDialog(b.value)}>{b.label}</button
          >
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); display: grid; place-items: center; z-index: 100; animation: fade 0.12s; }
  .dialog { width: min(440px, calc(100vw - 32px)); background: var(--bg-elev); border-radius: 16px; box-shadow: var(--shadow-lg); padding: 22px 22px 18px; border: 1px solid var(--border); }
  h2 { margin: 0 0 8px; font-size: 17px; font-weight: 650; }
  p { margin: 0 0 20px; color: var(--text-2); line-height: 1.5; }
  .buttons { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
  @keyframes fade { from { opacity: 0; } }
</style>

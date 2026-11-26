<script lang="ts">
  import { app, go, moveConversation, saveProject } from "../lib/state.svelte";
  import { uid } from "../lib/util";

  const ed = $derived(app.projectEditor);
  let name = $state("");
  let description = $state("");
  let instructions = $state("");
  let saving = $state(false);

  $effect(() => {
    if (ed) {
      name = ed.project?.name ?? "";
      description = ed.project?.description ?? "";
      instructions = ed.project?.instructions ?? "";
    }
  });

  function close() {
    app.projectEditor = null;
  }

  async function save(e: Event) {
    e.preventDefault();
    if (!name.trim() || !ed) return;
    saving = true;
    const now = Date.now();
    const p = ed.project
      ? { ...$state.snapshot(ed.project), name: name.trim(), description: description.trim(), instructions: instructions.trim() }
      : { id: uid(), name: name.trim(), description: description.trim(), instructions: instructions.trim(), color: null, createdAt: now, updatedAt: now };
    const saved = await saveProject(p);
    saving = false;
    if (!saved) return;
    const moveId = ed.thenMove;
    const isNew = !ed.project;
    close();
    if (moveId) {
      const c = app.conv(moveId);
      if (c) await moveConversation(c, saved.id);
    } else if (isNew && app.route.name !== "home") {
      go({ name: "project", id: saved.id });
    } else if (isNew) {
      app.draftProjectId = saved.id;
    }
  }
</script>

{#if ed}
  <div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
    <form class="sheet" onsubmit={save}>
      <h2>{ed.project ? "Edit project" : "New project"}</h2>
      <label class="field">
        <span>Name</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input class="input" bind:value={name} placeholder="e.g. Home renovation research" autofocus maxlength="120" />
      </label>
      <label class="field">
        <span>Description</span>
        <textarea class="textarea" bind:value={description} rows="2" placeholder="What is this project about? (optional)"></textarea>
      </label>
      <label class="field">
        <span>Instructions</span>
        <textarea class="textarea" bind:value={instructions} rows="3" placeholder="e.g. Answer for a European audience and prefer peer-reviewed sources."></textarea>
        <small>Added in front of the first question of every new search in this project, so Google gets the same context each time.</small>
      </label>
      <div class="buttons">
        <button type="button" class="btn" onclick={close}>Cancel</button>
        <button type="submit" class="btn primary" disabled={!name.trim() || saving}>{ed.project ? "Save" : "Create project"}</button>
      </div>
    </form>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); display: grid; place-items: center; z-index: 90; }
  .sheet { width: min(520px, calc(100vw - 32px)); background: var(--bg-elev); border-radius: 16px; border: 1px solid var(--border); box-shadow: var(--shadow-lg); padding: 22px; }
  h2 { margin: 0 0 16px; font-size: 18px; font-weight: 650; }
  .buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
</style>

<script lang="ts">
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import Icon from "./Icon.svelte";
  import ProjectPicker from "./ProjectPicker.svelte";
  import { api, errorText } from "../lib/api";
  import { parseImport, type ImportItem, type ImportKind } from "../lib/importer";
  import { renderMarkdown } from "../lib/markdown";
  import { app, go, importConversations, toast } from "../lib/state.svelte";

  let items = $state<ImportItem[]>([]);
  let problems = $state<string[]>([]);
  let fileCount = $state(0);
  let selected = $state<Record<string, boolean>>({});
  let expanded = $state<string | null>(null);
  let projectId = $state<string | null>(app.route.name === "project" ? app.route.id : null);
  let busy = $state(false);

  const KIND: Record<ImportKind, string> = {
    app: "AI Search",
    markdown: "Markdown",
    json: "JSON",
    pair: "MD + JSON",
    text: "Text",
  };

  const chosen = $derived(items.filter((i) => selected[i.key]));
  const duplicates = $derived(items.filter((i) => i.duplicate).length);

  // Paths handed over by drag & drop are read straight away.
  $effect(() => {
    const paths = app.importer?.paths ?? [];
    if (paths.length) {
      app.importer = { paths: [] };
      void read(paths);
    }
  });

  async function read(paths: string[]) {
    busy = true;
    try {
      const r = await api.readImportFiles(paths);
      const parsed = parseImport(r.files, app.conversations);
      // Add to what is already listed (several picks in a row).
      const have = new Set(items.flatMap((i) => i.files));
      const fresh = parsed.items.filter((i) => !i.files.every((f) => have.has(f)));
      items = [...items, ...fresh];
      for (const i of fresh) selected[i.key] = !i.duplicate && !i.warnings.includes("Empty answer");
      problems = [...problems, ...r.skipped, ...parsed.errors];
      fileCount += r.files.length;
      if (!r.files.length && !r.skipped.length) problems = [...problems, "No .md, .json or .txt files found there."];
    } catch (e) {
      problems = [...problems, errorText(e)];
    } finally {
      busy = false;
    }
  }

  async function pickFiles() {
    const res = await openDialog({
      multiple: true,
      title: "Import searches",
      filters: [{ name: "Exports", extensions: ["md", "markdown", "json", "txt"] }],
    });
    const paths = Array.isArray(res) ? res : res ? [res] : [];
    if (paths.length) await read(paths);
  }

  async function pickFolder() {
    const res = await openDialog({ directory: true, multiple: false, title: "Import a folder of exports" });
    if (typeof res === "string") await read([res]);
  }

  function setAll(on: boolean) {
    for (const i of items) selected[i.key] = on;
  }

  function close() {
    app.importer = null;
  }

  async function doImport() {
    if (!chosen.length) return;
    busy = true;
    const n = await importConversations(chosen.map((i) => i.conversation), projectId);
    busy = false;
    close();
    if (n) {
      toast(`Imported ${n} search${n === 1 ? "" : "es"}`, "success", {
        label: "View",
        run: () => (projectId ? go({ name: "project", id: projectId }) : go({ name: "search", q: "imported" })),
      });
    }
  }

  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  const turns = (i: ImportItem) => i.conversation.messages.filter((m) => m.role === "user").length;
  const sourceCount = (i: ImportItem) => i.conversation.messages.reduce((n, m) => n + (m.sources?.length ?? 0), 0);
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && !busy && close()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && !busy && close()}>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Import searches">
    <header>
      <div>
        <h2>Import searches</h2>
        <p class="muted">Markdown (.md) works best: it keeps the full answer. A .md and .json with the same name are combined.</p>
      </div>
      <button class="icon-btn" onclick={close} aria-label="Close" disabled={busy}><Icon name="x" /></button>
    </header>

    {#if !items.length}
      <div class="drop">
        {#if busy}
          <span class="spinner"></span> Reading files…
        {:else}
          <Icon name="download" size={28} />
          <div class="drop-title">Drop exported files or folders on the window</div>
          <div class="muted">or</div>
          <div class="row">
            <button class="btn primary" onclick={pickFiles}><Icon name="plus" size={14} /> Choose files…</button>
            <button class="btn" onclick={pickFolder}><Icon name="folder-open" size={14} /> Choose a folder…</button>
          </div>
          <div class="formats">
            Reads <b>.md</b> (title from the first heading; a trailing <i>References</i>/<i>Sources</i> list becomes source cards),
            <b>.json</b> (any shape: a single search, a list of searches, or this app's own files) and <b>.txt</b>.
          </div>
        {/if}
      </div>
    {:else}
      <div class="bar">
        <span><b>{items.length}</b> search{items.length === 1 ? "" : "es"} from {fileCount} file{fileCount === 1 ? "" : "s"}{duplicates ? ` · ${duplicates} already in your library` : ""}</span>
        <span class="grow"></span>
        <button class="btn sm ghost" onclick={() => setAll(true)}>Select all</button>
        <button class="btn sm ghost" onclick={() => setAll(false)}>None</button>
        <button class="btn sm" onclick={pickFiles} disabled={busy}><Icon name="plus" size={12} /> Add files</button>
      </div>
      <div class="list">
        {#each items as i (i.key)}
          <div class="item" class:off={!selected[i.key]}>
            <div class="item-row">
              <input type="checkbox" bind:checked={selected[i.key]} aria-label="Import {i.conversation.title}" />
              <button class="item-main" onclick={() => (expanded = expanded === i.key ? null : i.key)}>
                <span class="t">{i.conversation.title}</span>
                <span class="meta">
                  <span class="badge">{KIND[i.kind]}</span>
                  {fmtDate(i.conversation.createdAt)} · {turns(i)} question{turns(i) === 1 ? "" : "s"} · {sourceCount(i)} source{sourceCount(i) === 1 ? "" : "s"}
                  · <span class="files">{i.files.join(" + ")}</span>
                </span>
                {#each i.warnings as w (w)}<span class="warn"><Icon name="alert" size={12} /> {w}</span>{/each}
              </button>
              <Icon name={expanded === i.key ? "chevron-down" : "chevron-right"} size={14} class="chev" />
            </div>
            {#if expanded === i.key}
              <div class="preview">
                {#each i.conversation.messages as m (m.id)}
                  {#if m.role === "user"}
                    <div class="pq"><Icon name="search" size={13} /> {m.content}</div>
                  {:else}
                    <div class="prose">{@html renderMarkdown(m.content)}</div>
                    {#if m.sources?.length}
                      <ol class="psrc">{#each m.sources as s (s.url)}<li>{s.title} <span class="muted">— {s.url}</span></li>{/each}</ol>
                    {/if}
                  {/if}
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      </div>
    {/if}

    {#if problems.length}
      <details class="problems">
        <summary><Icon name="alert" size={13} /> {problems.length} file{problems.length === 1 ? "" : "s"} skipped</summary>
        <ul>{#each problems as p (p)}<li class="mono">{p}</li>{/each}</ul>
      </details>
    {/if}

    <footer>
      <span class="muted">Add to</span>
      <ProjectPicker value={projectId} onchange={(id) => (projectId = id)} up />
      <span class="grow"></span>
      <button class="btn" onclick={close} disabled={busy}>Cancel</button>
      <button class="btn primary" onclick={doImport} disabled={busy || !chosen.length}>
        {#if busy && items.length}<span class="spinner"></span>{/if}
        Import {chosen.length || ""} search{chosen.length === 1 ? "" : "es"}
      </button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); display: grid; place-items: center; z-index: 85; }
  .modal { width: min(780px, calc(100vw - 40px)); max-height: min(720px, calc(100vh - 40px)); background: var(--bg); border: 1px solid var(--border); border-radius: 16px; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; overflow: hidden; }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px 12px; }
  h2 { margin: 0 0 4px; font-family: var(--font-display); font-size: 18px; font-weight: 750; letter-spacing: -0.02em; }
  header p { margin: 0; font-size: 13px; }
  .drop { margin: 4px 20px 16px; padding: 36px 20px; border: 2px dashed var(--border-strong); border-radius: var(--radius); display: flex; flex-direction: column; align-items: center; gap: 10px; color: var(--text-2); text-align: center; }
  .drop > :global(.icon) { color: var(--accent); }
  .drop-title { font-weight: 650; color: var(--text); }
  .formats { max-width: 520px; font-size: 12.5px; color: var(--text-3); line-height: 1.5; margin-top: 8px; }
  .bar { display: flex; align-items: center; gap: 6px; padding: 0 20px 8px; font-size: 13px; color: var(--text-2); }
  .list { flex: 1; overflow-y: auto; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); min-height: 120px; }
  .item { border-bottom: 1px solid var(--border); }
  .item.off .item-main { opacity: 0.55; }
  .item-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 16px 10px 20px; }
  .item-row input { margin-top: 4px; accent-color: var(--accent); }
  .item-row :global(.chev) { color: var(--text-3); margin-top: 4px; }
  .item-main { flex: 1; min-width: 0; text-align: left; border: none; background: none; padding: 0; display: flex; flex-direction: column; gap: 3px; }
  .t { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { font-size: 12px; color: var(--text-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { display: inline-block; font-size: 10.5px; font-weight: 700; letter-spacing: 0.03em; padding: 1px 6px; border-radius: 4px; background: var(--accent-soft); color: var(--accent); margin-right: 4px; }
  .files { font-family: var(--font-mono); font-size: 11px; }
  .warn { font-size: 12px; color: var(--warn); display: inline-flex; align-items: center; gap: 4px; }
  .preview { padding: 4px 24px 16px 46px; max-height: 320px; overflow-y: auto; }
  .pq { display: flex; align-items: center; gap: 7px; font-weight: 650; margin: 8px 0; color: var(--text); }
  .pq :global(.icon) { color: var(--accent); }
  .preview .prose { font-size: 13.5px; }
  .psrc { font-size: 12px; color: var(--text-2); padding-left: 18px; margin: 8px 0 0; }
  .problems { margin: 8px 20px 0; font-size: 12.5px; color: var(--warn); }
  .problems summary { cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
  .problems ul { margin: 6px 0 0; padding-left: 18px; color: var(--text-2); font-size: 11.5px; max-height: 90px; overflow-y: auto; }
  footer { display: flex; align-items: center; gap: 8px; padding: 12px 20px; }
  footer .muted { font-size: 13px; }
</style>

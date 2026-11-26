<script lang="ts">
  import { open as openDialog } from "@tauri-apps/plugin-dialog";
  import Icon from "./Icon.svelte";
  import { api, errorText } from "../lib/api";
  import { app, reloadLibrary, saveSettings, toast } from "../lib/state.svelte";
  import { setGoogleVisible } from "../lib/google.svelte";
  import type { Settings, SyncReport } from "../lib/types";

  const tabs = [
    { id: "general", label: "General", icon: "settings" },
    { id: "google", label: "Google", icon: "globe" },
    { id: "sync", label: "Sync", icon: "cloud" },
    { id: "about", label: "About", icon: "sparkle" },
  ] as const;

  let draft = $state<Settings>(structuredClone($state.snapshot(app.settings!)) as Settings);
  let defaultPath = $state("");
  let showToken = $state(false);
  let showKey = $state(false);
  let saving = $state(false);
  let syncing = $state<"" | "github" | "jsonbin">("");
  let lastResult = $state<{ backend: string; ok: boolean; text: string } | null>(null);
  let answerSel = $state(app.settings!.google.answerSelectors.join("\n"));
  let inputSel = $state(app.settings!.google.inputSelectors.join("\n"));

  $effect(() => {
    api.defaultLibraryPath().then((p) => (defaultPath = p));
  });

  const dirty = $derived(
    JSON.stringify(collect()) !== JSON.stringify($state.snapshot(app.settings)),
  );

  function collect(): Settings {
    const s = $state.snapshot(draft) as Settings;
    const lines = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);
    s.google.answerSelectors = lines(answerSel);
    s.google.inputSelectors = lines(inputSel);
    s.google.timeoutSecs = Math.max(15, Math.min(900, Number(s.google.timeoutSecs) || 120));
    s.google.stableMs = Math.max(800, Math.min(20000, Number(s.google.stableMs) || 3000));
    s.jsonbin.chunkKb = Math.max(10, Math.min(10000, Number(s.jsonbin.chunkKb) || 90));
    return s;
  }

  async function save(close = false): Promise<boolean> {
    saving = true;
    try {
      await saveSettings(collect());
      draft = structuredClone($state.snapshot(app.settings!)) as Settings;
      if (close) app.showSettings = false;
      return true;
    } catch (e) {
      toast("Couldn't save settings: " + errorText(e), "error");
      return false;
    } finally {
      saving = false;
    }
  }

  function close() {
    app.showSettings = false;
  }

  async function browse() {
    const dir = await openDialog({ directory: true, multiple: false, title: "Choose library folder" });
    if (typeof dir === "string") draft.libraryPath = dir;
  }

  function describe(r: SyncReport): string {
    const p = r.pulled;
    const pulled = p.added + p.updated + p.deleted;
    return `${r.message}${pulled ? ` (${p.added} new, ${p.updated} updated, ${p.deleted} deleted locally)` : ""}${r.warnings?.length ? `\nWarnings: ${r.warnings.join("; ")}` : ""}`;
  }

  async function syncNow(backend: "github" | "jsonbin") {
    if (!(await save())) return;
    syncing = backend;
    lastResult = null;
    try {
      const r = backend === "github" ? await api.syncGithub() : await api.syncJsonbin();
      lastResult = { backend, ok: true, text: describe(r) };
      app.sync.lastAt = Date.now();
      app.sync.error = "";
      // Pick up pulled changes and the JSONBin manifest id.
      const s = await api.getSettings();
      app.settings = s;
      draft.jsonbin.manifestBinId = s.jsonbin.manifestBinId;
      await reloadQuiet();
    } catch (e) {
      lastResult = { backend, ok: false, text: errorText(e) };
    } finally {
      syncing = "";
    }
  }

  async function reloadQuiet() {
    const p = await api.loadLibrary();
    app.projects = p.snapshot.projects;
    app.conversations = p.snapshot.conversations;
    app.index.rebuild(app.conversations, app.projects);
    app.indexVersion++;
  }

  function link(url: string) {
    void api.openUrl(url);
  }

  function resetSelectors() {
    answerSel = 'div[data-subtree="aimc"]';
    inputSel = [
      'textarea[aria-label*="follow" i]',
      'textarea[placeholder*="follow" i]',
      'textarea[aria-label*="ask" i]',
      'textarea[placeholder*="ask" i]',
      '[contenteditable="true"][role="textbox"]',
      "textarea",
    ].join("\n");
  }

  async function snapshot() {
    try {
      await api.googleDebugDump();
    } catch (e) {
      toast(errorText(e), "error");
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

<div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
  <div class="modal" role="dialog" aria-modal="true" aria-label="Settings">
    <nav class="tabs">
      <div class="tabs-title">Settings</div>
      {#each tabs as t (t.id)}
        <button class="tab" class:active={app.settingsTab === t.id} onclick={() => (app.settingsTab = t.id)}>
          <Icon name={t.icon} size={15} /> {t.label}
        </button>
      {/each}
    </nav>

    <section class="content">
      <button class="icon-btn close" onclick={close} aria-label="Close"><Icon name="x" /></button>

      {#if app.settingsTab === "general"}
        <h2>General</h2>
        <div class="field">
          <span>Library folder</span>
          <div class="row">
            <input class="input mono grow" bind:value={draft.libraryPath} placeholder={defaultPath} />
            <button class="btn" onclick={browse}><Icon name="folder-open" size={14} /> Browse…</button>
          </div>
          <small>
            Everything lives here as plain files: <code>searches/</code> for unfiled searches, <code>projects/&lt;name&gt;/</code>
            for projects, one JSON file per conversation. Leave empty for the default. Switching folders doesn't move existing files.
          </small>
          <div class="row" style="margin-top:4px">
            <button class="btn sm" onclick={() => api.revealLibrary()}><Icon name="external" size={12} /> Open current folder</button>
            <button class="btn sm" onclick={reloadLibrary}><Icon name="refresh" size={12} /> Reload from disk</button>
            <span class="muted path mono">{app.root}</span>
          </div>
        </div>
        <label class="check">
          <input type="checkbox" bind:checked={draft.writeMarkdown} />
          <span><b>Write Markdown copies</b><small>A readable <code>.md</code> next to every conversation, nice for browsing the folder or the GitHub repo. JSON stays the source of truth.</small></span>
        </label>
        <div class="field">
          <span>Theme</span>
          <select class="select" bind:value={draft.theme} style="width:200px">
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
        {#if app.loadErrors.length}
          <div class="warnbox">
            <b>{app.loadErrors.length} file(s) couldn't be read</b> and were skipped (they are left untouched on disk):
            <ul>{#each app.loadErrors as e (e)}<li class="mono">{e}</li>{/each}</ul>
          </div>
        {/if}
      {:else if app.settingsTab === "google"}
        <h2>Google AI Mode</h2>
        <p class="lead">
          Searches run in a dedicated Google window, a real browser view with its own cookies. It stays hidden unless Google needs you
          (consent, CAPTCHA) or you open it. Sign in there to use AI Mode with your account.
        </p>
        <div class="row" style="margin-bottom:18px">
          <button class="btn" onclick={() => setGoogleVisible(true)}><Icon name="eye" size={14} /> Show Google window</button>
          <button class="btn" onclick={() => api.googleHome().then(() => setGoogleVisible(true))}><Icon name="home" size={14} /> Open AI Mode home</button>
        </div>
        <label class="check">
          <input type="checkbox" bind:checked={draft.google.showWindow} />
          <span><b>Keep the Google window visible while searching</b><small>Handy for watching the answer or if answers stall while the window is hidden.</small></span>
        </label>
        <div class="grid2">
          <label class="field"><span>Language (hl)</span><input class="input" bind:value={draft.google.hl} placeholder="en" /></label>
          <label class="field"><span>Timeout (seconds)</span><input class="input" type="number" min="15" max="900" bind:value={draft.google.timeoutSecs} /></label>
        </div>
        <label class="field">
          <span>Answer is final after it stops changing for (ms)</span>
          <input class="input" type="number" min="800" max="20000" step="100" bind:value={draft.google.stableMs} style="width:200px" />
          <small>Increase this if long answers get cut off.</small>
        </label>

        <details class="adv">
          <summary>Advanced</summary>
          <label class="field">
            <span>User agent</span>
            <input class="input mono" bind:value={draft.google.userAgent} placeholder="Default (on Linux, a Safari user agent)" />
            <small>Applies the next time the app starts.</small>
          </label>
          <label class="field">
            <span>Answer container selectors (one per line)</span>
            <textarea class="textarea mono" rows="3" bind:value={answerSel}></textarea>
          </label>
          <label class="field">
            <span>Follow-up input selectors (one per line, tried in order)</span>
            <textarea class="textarea mono" rows="5" bind:value={inputSel}></textarea>
            <small>Google changes its page layout from time to time. If answers stop being captured, open the Google window, save a page snapshot and adjust these selectors.</small>
          </label>
          <div class="row">
            <button class="btn sm" onclick={resetSelectors}>Reset to defaults</button>
            <button class="btn sm" onclick={snapshot}><Icon name="download" size={12} /> Save page snapshot</button>
          </div>
        </details>
      {:else if app.settingsTab === "sync"}
        <h2>Sync</h2>
        <p class="lead">Sync is two-way. Records are merged per conversation; when two devices add turns to the same search, both are kept. Deletions sync too.</p>
        <label class="check">
          <input type="checkbox" bind:checked={draft.autoSync} />
          <span><b>Sync automatically</b><small>On start-up, and about 20 seconds after you change something.</small></span>
        </label>

        <div class="card">
          <div class="card-head">
            <label class="check inline"><input type="checkbox" bind:checked={draft.github.enabled} /> <b>GitHub</b></label>
            <button class="btn sm" disabled={!!syncing || !draft.github.token} onclick={() => syncNow("github")}>
              {#if syncing === "github"}<span class="spinner"></span>{:else}<Icon name="refresh" size={12} />{/if} Save & sync now
            </button>
          </div>
          <p class="hint">
            Commits your library to a repository (one commit per sync, via the GitHub API, so git doesn't need to be installed). Use a
            <button class="linkish" onclick={() => link("https://github.com/settings/personal-access-tokens/new")}>fine-grained token</button>
            limited to that repo, with <b>Contents: Read and write</b>. Private repos recommended.
          </p>
          <label class="field">
            <span>Personal access token</span>
            <div class="row">
              <input class="input mono grow" type={showToken ? "text" : "password"} bind:value={draft.github.token} placeholder="github_pat_…" autocomplete="off" />
              <button class="icon-btn" onclick={() => (showToken = !showToken)} title="Show/hide"><Icon name={showToken ? "eye-off" : "eye"} /></button>
            </div>
          </label>
          <div class="grid2">
            <label class="field"><span>Owner</span><input class="input" bind:value={draft.github.owner} placeholder="your-username" /></label>
            <label class="field"><span>Repository</span><input class="input" bind:value={draft.github.repo} placeholder="ai-search-library" /></label>
            <label class="field"><span>Branch</span><input class="input" bind:value={draft.github.branch} placeholder="main" /></label>
            <label class="field"><span>Folder in repo</span><input class="input" bind:value={draft.github.path} placeholder="library (empty = root)" /></label>
          </div>
          {#if lastResult?.backend === "github"}<div class="result" class:bad={!lastResult.ok}>{lastResult.text}</div>{/if}
        </div>

        <div class="card">
          <div class="card-head">
            <label class="check inline"><input type="checkbox" bind:checked={draft.jsonbin.enabled} /> <b>JSONBin.io</b></label>
            <button class="btn sm" disabled={!!syncing || !draft.jsonbin.masterKey} onclick={() => syncNow("jsonbin")}>
              {#if syncing === "jsonbin"}<span class="spinner"></span>{:else}<Icon name="refresh" size={12} />{/if} Save & sync now
            </button>
          </div>
          <p class="hint">
            Stores the library in private bins: one manifest and as many ~90 KB chunks as needed (the free plan caps records at 100 KB).
            Only changed chunks are uploaded. Get your key under
            <button class="linkish" onclick={() => link("https://jsonbin.io/app/app/api-keys")}>API Keys</button>.
          </p>
          <label class="field">
            <span>X-Master-Key</span>
            <div class="row">
              <input class="input mono grow" type={showKey ? "text" : "password"} bind:value={draft.jsonbin.masterKey} placeholder="$2a$10$…" autocomplete="off" />
              <button class="icon-btn" onclick={() => (showKey = !showKey)} title="Show/hide"><Icon name={showKey ? "eye-off" : "eye"} /></button>
            </div>
          </label>
          <div class="grid2">
            <label class="field">
              <span>Manifest bin ID</span>
              <input class="input mono" bind:value={draft.jsonbin.manifestBinId} placeholder="created on first sync" />
              <small>To sync another computer, paste this ID there.</small>
            </label>
            <label class="field">
              <span>Chunk size (KB)</span>
              <input class="input" type="number" min="10" max="10000" bind:value={draft.jsonbin.chunkKb} />
              <small>Keep under 100 on the free plan.</small>
            </label>
          </div>
          {#if lastResult?.backend === "jsonbin"}<div class="result" class:bad={!lastResult.ok}>{lastResult.text}</div>{/if}
        </div>
        <p class="hint">Tokens are stored only on this computer, in the app's settings file (readable only by your user).</p>
      {:else}
        <h2>About AI Search</h2>
        <p class="lead">
          A lightweight desktop client (Tauri + Svelte) for Google AI Mode, with a local, searchable library of your searches and follow-ups,
          projects, and optional sync to GitHub and JSONBin.
        </p>
        <ul class="about">
          <li>Your data stays in plain JSON and Markdown files you own: <span class="mono">{app.root}</span></li>
          <li>AI Search is not affiliated with Google. It drives Google's normal web page in your own session, so Google's terms of service apply. Use it for personal research.</li>
          <li>Keyboard: <span class="kbd">⌘/Ctrl N</span> new search · <span class="kbd">⌘/Ctrl K</span> search library · <span class="kbd">⌘/Ctrl ,</span> settings · <span class="kbd">Shift ⏎</span> new line</li>
        </ul>
        <button class="btn" onclick={() => link("https://github.com/KKrampis/AI-search")}><Icon name="external" size={14} /> Project on GitHub</button>
      {/if}
    </section>

    <footer class="foot">
      <span class="muted">{dirty ? "Unsaved changes" : ""}</span>
      <button class="btn" onclick={close}>Close</button>
      <button class="btn primary" disabled={!dirty || saving} onclick={() => save(true)}>Save</button>
    </footer>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.35); display: grid; place-items: center; z-index: 80; }
  .modal {
    width: min(860px, calc(100vw - 40px)); height: min(680px, calc(100vh - 40px));
    background: var(--bg); border: 1px solid var(--border); border-radius: 18px; box-shadow: var(--shadow-lg);
    display: grid; grid-template-columns: 190px 1fr; grid-template-rows: 1fr auto; overflow: hidden;
  }
  .tabs { grid-row: span 2; background: var(--bg-sidebar); border-right: 1px solid var(--border); padding: 18px 10px; display: flex; flex-direction: column; gap: 2px; }
  .tabs-title { font-family: var(--font-serif); font-size: 18px; padding: 0 10px 12px; }
  .tab { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border: none; background: none; border-radius: var(--radius-sm); color: var(--text-2); text-align: left; }
  .tab:hover { background: var(--bg-hover); color: var(--text); }
  .tab.active { background: var(--bg-active); color: var(--text); font-weight: 550; }
  .content { overflow-y: auto; padding: 22px 28px 20px; position: relative; }
  .close { position: absolute; top: 14px; right: 14px; }
  h2 { margin: 0 0 14px; font-size: 19px; font-weight: 650; }
  .lead { color: var(--text-2); margin: -4px 0 18px; line-height: 1.55; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 14px; }
  .path { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  code { font-family: var(--font-mono); font-size: 0.9em; background: var(--bg-code); padding: 0 4px; border-radius: 4px; }
  .card { border: 1px solid var(--border); border-radius: var(--radius); padding: 14px 16px 4px; margin-bottom: 14px; background: var(--bg-elev); }
  .card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
  .check.inline { margin: 0; align-items: center; font-size: 15px; }
  .hint { color: var(--text-3); font-size: 12.5px; line-height: 1.5; margin: 0 0 12px; }
  .linkish { border: none; background: none; padding: 0; color: var(--accent); text-decoration: underline; font-size: inherit; }
  .result { font-size: 12.5px; padding: 8px 10px; margin: 0 0 12px; border-radius: var(--radius-sm); background: rgba(46, 125, 79, 0.1); white-space: pre-line; }
  .result.bad { background: rgba(192, 57, 43, 0.1); color: var(--danger); }
  .adv { margin-top: 6px; border-top: 1px solid var(--border); padding-top: 12px; }
  .adv summary { cursor: pointer; font-weight: 600; color: var(--text-2); margin-bottom: 12px; }
  .warnbox { padding: 10px 12px; border-radius: var(--radius-sm); background: rgba(168, 107, 0, 0.1); font-size: 13px; }
  .warnbox ul { margin: 6px 0 0; padding-left: 18px; font-size: 12px; }
  .about { padding-left: 18px; color: var(--text-2); line-height: 1.6; margin: 0 0 18px; }
  .about li { margin-bottom: 6px; }
  .foot { grid-column: 2; display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: 1px solid var(--border); }
  .foot .muted { margin-right: auto; font-size: 12.5px; }
</style>

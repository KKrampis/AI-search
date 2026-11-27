<script lang="ts">
  import Composer from "./Composer.svelte";
  import ProjectPicker from "./ProjectPicker.svelte";
  import Icon from "./Icon.svelte";
  import { app, go } from "../lib/state.svelte";
  import { startConversation } from "../lib/google.svelte";
  import { relativeTime } from "../lib/util";

  const greeting = $derived.by(() => {
    const h = new Date().getHours();
    return h < 5 ? "Up late?" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  });
  const project = $derived(app.project(app.draftProjectId));
  const recent = $derived(
    (app.draftProjectId ? app.recent.filter((c) => c.projectId === app.draftProjectId) : app.recent).slice(0, 4),
  );

  const suggestions = [
    "Compare Tauri, Electron and Wails for a small desktop app",
    "What changed in the latest Rust edition?",
    "Plan a 3-day trip to Lisbon in spring",
    "Explain how JSON Web Tokens can be revoked",
  ];

  function submit(text: string) {
    void startConversation(text, app.draftProjectId);
  }
</script>

<div class="page">
  <div class="home">
    {#if project}
      <div class="eyebrow"><Icon name="folder" size={13} /> Project</div>
      <h1 class="hello">{project.name}</h1>
    {:else}
      <div class="eyebrow">{greeting}</div>
      <h1 class="hello">What do you want to <span class="gradient-text">find out?</span></h1>
    {/if}
    {#if project?.description}<p class="desc">{project.description}</p>{/if}

    <Composer hero autofocus onsubmit={submit} blocked={!!app.busy} placeholder={project ? `Search in ${project.name}…` : "Ask Google AI Mode anything…"}>
      {#snippet footer()}
        <ProjectPicker value={app.draftProjectId} onchange={(id) => (app.draftProjectId = id)} />
        <span class="hint">AI Mode · follow-ups keep context</span>
      {/snippet}
    </Composer>

    {#if app.conversations.length === 0}
      <div class="suggest">
        {#each suggestions as s (s)}
          <button class="sugg" onclick={() => submit(s)} disabled={!!app.busy}>{s}</button>
        {/each}
      </div>
      <div class="first-run">
        <Icon name="globe" size={16} />
        <div>
          Searches run in Google AI Mode inside a separate, private Google window that stays hidden. If Google
          asks for cookie consent or a CAPTCHA, the window pops up so you can deal with it. Sign in there (sidebar →
          <b>Google window</b>) if you want AI Mode tied to your account.
        </div>
      </div>
    {:else}
      <div class="recent-head">
        <span>{project ? "Recent in this project" : "Recent searches"}</span>
        <button class="btn ghost sm" onclick={() => go(project ? { name: "project", id: project.id } : { name: "search" })}>View all</button>
      </div>
      <div class="cards">
        {#each recent as c (c.id)}
          <button class="card" onclick={() => go({ name: "chat", id: c.id })}>
            <span class="ct">{c.title}</span>
            <span class="cm">{relativeTime(c.updatedAt)} · {Math.ceil(c.messages.length / 2)} turn{c.messages.length > 2 ? "s" : ""}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .home { max-width: 720px; margin: 0 auto; padding: 14vh 28px 48px; }
  .eyebrow { text-align: center; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--accent); margin-bottom: 8px; display: flex; align-items: center; justify-content: center; gap: 6px; }
  .hello { font-family: var(--font-display); font-weight: 800; font-size: 34px; letter-spacing: -0.035em; line-height: 1.15; text-align: center; margin: 0 0 26px; }
  .desc { text-align: center; color: var(--text-2); margin: -12px 0 24px; }
  .hint { font-size: 12px; color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .suggest { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 18px; }
  .sugg { border: 1px solid var(--border); background: var(--bg-elev); border-radius: var(--radius-sm); padding: 6px 12px; font-size: 13px; color: var(--text-2); }
  .sugg:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .first-run { display: flex; gap: 12px; margin-top: 36px; padding: 14px 16px; border-radius: var(--radius); border: 1px solid var(--border); border-left: 3px solid var(--accent); background: var(--bg-elev); color: var(--text-2); font-size: 13px; line-height: 1.55; }
  .first-run :global(.icon) { color: var(--accent); margin-top: 2px; }
  .recent-head { display: flex; justify-content: space-between; align-items: center; margin: 34px 2px 8px; font-size: 13px; font-weight: 600; color: var(--text-2); }
  .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .card { display: flex; flex-direction: column; gap: 4px; text-align: left; padding: 12px 14px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--bg-elev); }
  .card { border-top: 2px solid transparent; }
  .card:hover { border-color: var(--border-strong); border-top-color: var(--accent); }
  .ct { font-weight: 550; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cm { font-size: 12px; color: var(--text-3); }
</style>

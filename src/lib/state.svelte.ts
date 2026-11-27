import { api, errorText } from "./api";
import { SearchIndex } from "./search";
import type { Conversation, LibraryPayload, Project, Route, Settings, SyncOutcome } from "./types";
import { uid } from "./util";

export interface Toast {
  id: string;
  kind: "info" | "success" | "error" | "warn";
  text: string;
  action?: { label: string; run: () => void };
}

export interface DialogButton {
  label: string;
  value: string;
  kind?: "primary" | "danger" | "plain";
}

interface DialogState {
  title: string;
  message: string;
  buttons: DialogButton[];
  resolve: (v: string | null) => void;
}

interface ProjectEditorState {
  project: Project | null; // null = create
  /** After creating, move this conversation into the new project. */
  thenMove?: string;
}

class AppState {
  ready = $state(false);
  root = $state("");
  loadErrors = $state<string[]>([]);
  projects = $state<Project[]>([]);
  conversations = $state<Conversation[]>([]);
  settings = $state<Settings | null>(null);
  route = $state<Route>({ name: "home" });
  /** Project preselected for the next new search on the home screen. */
  draftProjectId = $state<string | null>(null);

  showSettings = $state(false);
  settingsTab = $state<"general" | "google" | "sync" | "about">("general");
  dialog = $state<DialogState | null>(null);
  projectEditor = $state<ProjectEditorState | null>(null);
  /** Import window: open, optionally with paths to read right away (drag & drop). */
  importer = $state<{ paths: string[] } | null>(null);
  dragging = $state(false);
  toasts = $state<Toast[]>([]);

  sync = $state({ running: false, lastAt: 0, error: "" as string, message: "" });
  /** The search currently running in the Google window. */
  busy = $state<{ convId: string; msgId: string; jobId: string } | null>(null);
  googleVisible = $state(false);

  /** Bumped whenever the search index changes so views re-run queries. */
  indexVersion = $state(0);
  readonly index = new SearchIndex();

  recent = $derived([...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt));
  sortedProjects = $derived([...this.projects].sort((a, b) => a.name.localeCompare(b.name)));

  conv(id: string | null | undefined): Conversation | undefined {
    return id ? this.conversations.find((c) => c.id === id) : undefined;
  }
  project(id: string | null | undefined): Project | undefined {
    return id ? this.projects.find((p) => p.id === id) : undefined;
  }
  syncEnabled(): boolean {
    return !!(this.settings?.github.enabled || this.settings?.jsonbin.enabled);
  }
}

export const app = new AppState();

// ----------------------------------------------------------------- toasts

export function toast(text: string, kind: Toast["kind"] = "info", action?: Toast["action"], ms = 4500) {
  const t: Toast = { id: uid(), kind, text, action };
  app.toasts = [...app.toasts, t];
  if (ms > 0) setTimeout(() => dismissToast(t.id), kind === "error" ? ms * 2 : ms);
}

export function dismissToast(id: string) {
  app.toasts = app.toasts.filter((t) => t.id !== id);
}

export function confirmDialog(title: string, message: string, buttons: DialogButton[]): Promise<string | null> {
  return new Promise((resolve) => {
    app.dialog = { title, message, buttons, resolve };
  });
}

export function closeDialog(value: string | null) {
  const d = app.dialog;
  app.dialog = null;
  d?.resolve(value);
}

// ------------------------------------------------------------- navigation

export function go(route: Route) {
  app.route = route;
}

export function newSearch(projectId: string | null = null) {
  app.draftProjectId = projectId;
  go({ name: "home" });
}

// ---------------------------------------------------------------- library

function applyPayload(p: LibraryPayload) {
  app.root = p.root;
  app.loadErrors = p.errors;
  app.projects = p.snapshot.projects;
  // A search that was running when the app quit can't be resumed.
  for (const c of p.snapshot.conversations) {
    for (const m of c.messages) {
      if (m.status === "pending" || m.status === "needs_user") {
        m.status = m.content ? "partial" : "stopped";
        m.note = "Interrupted — the app was closed while this search was running.";
      }
    }
  }
  app.conversations = p.snapshot.conversations;
  app.index.rebuild(app.conversations, app.projects);
  app.indexVersion++;
  // The route may point at something that no longer exists.
  const r = app.route;
  if ((r.name === "chat" && !app.conv(r.id)) || (r.name === "project" && !app.project(r.id))) go({ name: "home" });
}

export async function init() {
  try {
    app.settings = await api.getSettings();
    applyTheme();
    applyPayload(await api.loadLibrary());
    app.ready = true;
    if (app.loadErrors.length) {
      toast(`${app.loadErrors.length} file(s) in the library couldn't be read (see Settings → General).`, "warn");
    }
    if (app.settings.autoSync && app.syncEnabled()) void runSync({ quiet: true });
  } catch (e) {
    app.ready = true;
    toast("Failed to start: " + errorText(e), "error", undefined, 0);
  }
}

export async function reloadLibrary() {
  try {
    applyPayload(await api.reloadLibrary());
    toast("Library reloaded from disk.", "success");
  } catch (e) {
    toast("Reload failed: " + errorText(e), "error");
  }
}

export function applyTheme() {
  const t = app.settings?.theme ?? "system";
  document.documentElement.dataset.theme = t === "system" ? "" : t;
  document.documentElement.style.colorScheme = t === "light" ? "light" : t === "system" ? "" : "dark";
}

export async function saveSettings(next: Settings) {
  const payload = await api.saveSettings($state.snapshot(next) as Settings);
  app.settings = next;
  applyTheme();
  applyPayload(payload);
}

let autoSyncTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleAutoSync() {
  if (!app.settings?.autoSync || !app.syncEnabled()) return;
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(() => void runSync({ quiet: true }), 20_000);
}

export async function persistConversation(c: Conversation, touch = true) {
  if (touch) c.updatedAt = Date.now();
  try {
    await api.saveConversation($state.snapshot(c) as Conversation);
    app.index.upsert(c, app.projects);
    app.indexVersion++;
    scheduleAutoSync();
  } catch (e) {
    toast("Couldn't save: " + errorText(e), "error");
  }
}

export function addConversation(c: Conversation): Conversation {
  app.conversations = [c, ...app.conversations];
  // Return the reactive proxy so later mutations update the UI.
  return app.conv(c.id)!;
}

export async function deleteConversation(id: string, ask = true) {
  const c = app.conv(id);
  if (!c) return;
  if (ask) {
    const r = await confirmDialog("Delete search?", `“${c.title}” will be deleted from this device and, on the next sync, from your sync targets.`, [
      { label: "Cancel", value: "cancel", kind: "plain" },
      { label: "Delete", value: "delete", kind: "danger" },
    ]);
    if (r !== "delete") return;
  }
  try {
    await api.deleteConversation(id);
    app.conversations = app.conversations.filter((x) => x.id !== id);
    app.index.remove(id);
    app.indexVersion++;
    if (app.route.name === "chat" && app.route.id === id) go({ name: "home" });
    scheduleAutoSync();
  } catch (e) {
    toast("Delete failed: " + errorText(e), "error");
  }
}

export async function toggleStar(c: Conversation) {
  c.starred = !c.starred;
  await persistConversation(c);
}

export async function renameConversation(c: Conversation, title: string) {
  const t = title.trim();
  if (!t || t === c.title) return;
  c.title = t;
  await persistConversation(c);
}

export async function moveConversation(c: Conversation, projectId: string | null) {
  if ((c.projectId ?? null) === projectId) return;
  c.projectId = projectId;
  await persistConversation(c);
  toast(projectId ? `Moved to ${app.project(projectId)?.name}` : "Removed from project", "success");
}

export async function saveProject(p: Project): Promise<Project | null> {
  p.updatedAt = Date.now();
  try {
    const saved = await api.saveProject($state.snapshot(p) as Project);
    const i = app.projects.findIndex((x) => x.id === saved.id);
    if (i >= 0) app.projects[i] = saved;
    else app.projects = [...app.projects, saved];
    // Project names are indexed with their conversations.
    app.index.rebuild(app.conversations, app.projects);
    app.indexVersion++;
    scheduleAutoSync();
    return saved;
  } catch (e) {
    toast("Couldn't save project: " + errorText(e), "error");
    return null;
  }
}

export async function deleteProject(id: string) {
  const p = app.project(id);
  if (!p) return;
  const count = app.conversations.filter((c) => c.projectId === id).length;
  const choice = await confirmDialog(
    `Delete “${p.name}”?`,
    count
      ? `This project has ${count} search${count === 1 ? "" : "es"}. Keep them (they move to your unfiled searches) or delete them too?`
      : "The project will be deleted.",
    count
      ? [
          { label: "Cancel", value: "cancel", kind: "plain" },
          { label: "Delete everything", value: "all", kind: "danger" },
          { label: "Keep searches", value: "keep", kind: "primary" },
        ]
      : [
          { label: "Cancel", value: "cancel", kind: "plain" },
          { label: "Delete", value: "keep", kind: "danger" },
        ],
  );
  if (choice !== "keep" && choice !== "all") return;
  try {
    applyPayload(await api.deleteProject(id, choice === "all"));
    go({ name: "projects" });
    scheduleAutoSync();
  } catch (e) {
    toast("Delete failed: " + errorText(e), "error");
  }
}

// ----------------------------------------------------------------- import

/** Save imported conversations. Returns how many were saved. */
export async function importConversations(convs: Conversation[], projectId: string | null): Promise<number> {
  let saved = 0;
  const existing = new Set(app.conversations.map((c) => c.id));
  const added: Conversation[] = [];
  for (const c0 of convs) {
    const c: Conversation = $state.snapshot(c0) as Conversation;
    // Never overwrite a search that is already in the library: import a copy.
    if (existing.has(c.id)) c.id = uid();
    // Keep a conversation's own project if it exists here, otherwise use the chosen one.
    if (!c.projectId || !app.project(c.projectId)) c.projectId = projectId;
    try {
      await api.saveConversation(c);
      added.push(c);
      existing.add(c.id);
      saved++;
    } catch (e) {
      toast(`Couldn't import “${c.title}”: ${errorText(e)}`, "error");
    }
  }
  if (added.length) {
    app.conversations = [...added, ...app.conversations];
    app.index.rebuild(app.conversations, app.projects);
    app.indexVersion++;
    scheduleAutoSync();
  }
  return saved;
}

// ------------------------------------------------------------------- sync

export async function runSync(opts: { quiet?: boolean } = {}) {
  if (app.sync.running) return;
  if (!app.syncEnabled()) {
    app.settingsTab = "sync";
    app.showSettings = true;
    return;
  }
  app.sync.running = true;
  app.sync.error = "";
  try {
    const outcomes: SyncOutcome[] = await api.syncAll();
    const failed = outcomes.filter((o) => !o.ok);
    const pulled = outcomes.reduce((n, o) => n + (o.report ? o.report.pulled.added + o.report.pulled.updated + o.report.pulled.deleted : 0), 0);
    if (pulled > 0) applyPayload(await api.loadLibrary());
    // JSONBin may have created a manifest bin on first sync.
    app.settings = await api.getSettings();
    app.sync.lastAt = Date.now();
    app.sync.message = outcomes.map((o) => `${o.backend === "github" ? "GitHub" : "JSONBin"}: ${o.ok ? o.report?.message : o.error}`).join("\n");
    if (failed.length) {
      app.sync.error = failed.map((f) => `${f.backend === "github" ? "GitHub" : "JSONBin"}: ${f.error}`).join("\n");
      toast("Sync failed — " + app.sync.error, "error");
    } else if (!opts.quiet || pulled > 0) {
      toast(pulled > 0 ? `Synced · ${pulled} change(s) pulled` : "Synced", "success");
    }
    for (const o of outcomes) for (const w of o.report?.warnings ?? []) console.warn(`[sync:${o.backend}]`, w);
  } catch (e) {
    app.sync.error = errorText(e);
    toast("Sync failed — " + app.sync.error, "error");
  } finally {
    app.sync.running = false;
  }
}

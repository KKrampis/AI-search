// Orchestrates searches in the Google AI Mode window: one job at a time,
// streaming partial answers into the conversation, follow-ups in the same
// Google thread when possible, and recovery when it isn't.

import { api, errorText, onGoogleReport } from "./api";
import { addConversation, app, go, persistConversation, toast } from "./state.svelte";
import type { Conversation, GoogleReport, Message } from "./types";
import { makeTitle, truncate, uid } from "./util";

interface Job {
  jobId: string;
  convId: string;
  msgId: string;
  mode: "new" | "followup";
  prompt: string; // what the user typed
  startedAt: number;
  lastEventAt: number;
  gotContent: boolean;
  autoShown: boolean;
  fellBack: boolean;
}

let job: Job | null = null;
/** Conversation whose thread is currently open in the Google window. */
let thread: string | null = null;
let watchdog: ReturnType<typeof setInterval> | null = null;

export function isBusy(convId?: string): boolean {
  return !!app.busy && (convId === undefined || app.busy.convId === convId);
}

function findMsg(c: Conversation | undefined, id: string): Message | undefined {
  return c?.messages.find((m) => m.id === id);
}

function setBusy(j: Job | null) {
  job = j;
  app.busy = j ? { convId: j.convId, msgId: j.msgId, jobId: j.jobId } : null;
  if (watchdog) clearInterval(watchdog);
  watchdog = null;
  if (j) watchdog = setInterval(checkWatchdog, 2000);
}

function checkWatchdog() {
  if (!job) return;
  const now = Date.now();
  const timeout = (app.settings?.google.timeoutSecs ?? 120) * 1000;
  // Before any content, Google should at least have loaded the page.
  if (!job.gotContent && now - job.lastEventAt > 35_000) {
    void fail(job, "No response from the Google window. It may be stuck on a page that needs you — open it to check.", "stopped");
  } else if (now - job.startedAt > timeout + 30_000) {
    void fail(job, "The search took too long and was stopped.", "stopped");
  }
}

/** Build the text actually sent to Google. */
function composePrompt(c: Conversation, prompt: string, mode: "new" | "followup", userMsgId: string): string {
  if (mode === "followup") return prompt;
  const earlier = c.messages.filter((m) => m.role === "user" && m.id !== userMsgId);
  if (earlier.length === 0) {
    const instr = app.project(c.projectId)?.instructions?.trim();
    return instr ? `${instr}\n\n${prompt}` : prompt;
  }
  // Continuing an old conversation in a fresh Google thread: carry the earlier questions along.
  const ctx = earlier.slice(-3).map((m) => `“${truncate(m.content, 200)}”`).join("; ");
  return `${prompt}\n\n(Context: earlier in this conversation I asked ${ctx}.)`;
}

/** Start a brand-new conversation from the home screen. */
export async function startConversation(prompt: string, projectId: string | null) {
  const now = Date.now();
  const c = addConversation({
    id: uid(),
    title: makeTitle(prompt),
    projectId,
    createdAt: now,
    updatedAt: now,
    starred: false,
    tags: [],
    googleUrl: null,
    messages: [],
  });
  go({ name: "chat", id: c.id });
  await ask(c, prompt);
}

/** Ask (or follow up) in an existing conversation. */
export async function ask(c: Conversation, prompt: string, opts: { retryMsgId?: string } = {}) {
  const text = prompt.trim();
  if (!text) return;
  if (job) {
    toast("Another search is still running — wait for it or stop it first.", "warn");
    return;
  }
  const now = Date.now();
  let userMsg: Message | undefined;
  let botMsg: Message | undefined;

  if (opts.retryMsgId) {
    botMsg = findMsg(c, opts.retryMsgId);
    const i = c.messages.findIndex((m) => m.id === opts.retryMsgId);
    userMsg = i > 0 ? c.messages[i - 1] : undefined;
    if (!botMsg || !userMsg) return;
    Object.assign(botMsg, { content: "", sources: [], status: "pending", note: null });
  } else {
    c.messages.push({ id: uid(), role: "user", content: text, createdAt: now });
    c.messages.push({ id: uid(), role: "assistant", content: "", sources: [], createdAt: now + 1, status: "pending" });
    userMsg = c.messages[c.messages.length - 2];
    botMsg = c.messages[c.messages.length - 1];
  }

  // Follow up in Google's own thread when it is still the one on screen,
  // and only when this is the latest turn (retrying an old turn starts fresh).
  const isLatest = c.messages[c.messages.length - 1]?.id === botMsg.id;
  const hasEarlier = c.messages.some((m) => m.role === "assistant" && m.id !== botMsg!.id && m.status !== "error");
  const mode: "new" | "followup" = thread === c.id && hasEarlier && isLatest ? "followup" : "new";
  await launch(c, userMsg, botMsg, mode, false);
}

async function launch(c: Conversation, userMsg: Message, botMsg: Message, mode: "new" | "followup", fellBack: boolean) {
  const sent = composePrompt(c, userMsg.content, mode, userMsg.id);
  userMsg.sent = sent !== userMsg.content ? sent : null;
  if (mode === "new" && c.messages.filter((m) => m.role === "user").length > 1) {
    botMsg.note = "Started a new Google thread; your earlier questions were included as context.";
  }
  await persistConversation(c);

  const j: Job = {
    jobId: uid(),
    convId: c.id,
    msgId: botMsg.id,
    mode,
    prompt: userMsg.content,
    startedAt: Date.now(),
    lastEventAt: Date.now(),
    gotContent: false,
    autoShown: false,
    fellBack,
  };
  setBusy(j);
  if (mode === "new") thread = null;
  try {
    await api.googleAsk({ jobId: j.jobId, prompt: sent, mode });
  } catch (e) {
    await fail(j, "Couldn't reach the Google window: " + errorText(e), "error");
  }
}

async function fail(j: Job, message: string, status: "error" | "stopped") {
  if (job?.jobId !== j.jobId) return;
  const c = app.conv(j.convId);
  const m = findMsg(c, j.msgId);
  setBusy(null);
  if (c && m) {
    m.status = m.content ? "partial" : status;
    m.note = message;
    await persistConversation(c);
  }
  await maybeHide(j);
}

async function maybeHide(j: Job) {
  if (j.autoShown && !app.settings?.google.showWindow) {
    try {
      await api.googleShow(false);
      app.googleVisible = false;
    } catch {
      /* window may be gone */
    }
  }
}

export async function stop() {
  if (!job) return;
  const j = job;
  try {
    await api.googleCancel();
  } catch {
    /* ignore */
  }
  await fail(j, "Stopped.", "stopped");
}

/** Save the Google page's HTML to <library>/.aisearch/debug for selector tuning. */
export async function saveGoogleSnapshot() {
  try {
    await api.googleDebugDump(); // the bridge replies with a "debug" report, saved in handle()
  } catch (e) {
    toast(errorText(e), "error");
  }
}

export function openSelectorSettings() {
  app.settingsTab = "google";
  app.settingsAdvanced = true;
  app.showSettings = true;
}

export async function setGoogleVisible(visible: boolean) {
  try {
    await api.googleShow(visible);
    app.googleVisible = visible;
  } catch (e) {
    toast("Google window: " + errorText(e), "error");
  }
}

async function handle(r: GoogleReport) {
  if (r.kind === "debug") {
    try {
      const path = await api.saveDebugFile(`google-page-${new Date().toISOString().replace(/[:.]/g, "-")}.html`, r.html ?? "");
      toast(`Saved the Google page to ${path}`, "success", { label: "Open folder", run: () => void api.revealDebug() }, 12000);
    } catch (e) {
      toast("Couldn't save snapshot: " + errorText(e), "error");
    }
    return;
  }
  if (!job || r.jobId !== job.jobId) {
    // The user navigated the Google window by hand: its thread no longer matches.
    if (r.kind === "ready" && !r.jobId && !job) thread = null;
    return;
  }
  const j = job;
  j.lastEventAt = Date.now();
  const c = app.conv(j.convId);
  const m = findMsg(c, j.msgId);
  if (!c || !m) {
    setBusy(null);
    return;
  }

  switch (r.kind) {
    case "ready":
    case "submitted":
      if (m.status === "needs_user") {
        m.status = "pending";
        m.note = null;
      }
      return;
    case "partial":
      j.gotContent = true;
      m.status = "pending";
      m.note = null;
      m.content = r.markdown ?? m.content;
      return;
    case "needs_user":
      m.status = "needs_user";
      m.note = r.message ?? "Google needs your attention in the Google window.";
      if (!app.googleVisible) {
        j.autoShown = true;
        await setGoogleVisible(true);
      }
      // Give the user time: restart the clocks.
      j.startedAt = Date.now();
      return;
    case "done": {
      m.content = r.markdown ?? m.content;
      m.sources = r.sources ?? [];
      m.status = r.partial ? "partial" : "complete";
      m.note = [m.note && m.note.startsWith("Started a new Google thread") ? m.note : null, r.note].filter(Boolean).join(" ") || null;
      if (r.url) c.googleUrl = r.url;
      thread = c.id;
      setBusy(null);
      await persistConversation(c);
      await maybeHide(j);
      return;
    }
    case "error": {
      // The follow-up box wasn't usable: retry once as a fresh thread with context.
      if (j.mode === "followup" && !j.fellBack && (r.code === "no_input" || r.code === "no_bridge")) {
        setBusy(null);
        thread = null;
        const i = c.messages.findIndex((x) => x.id === m.id);
        const userMsg = c.messages[i - 1];
        if (userMsg) {
          await launch(c, userMsg, m, "new", true);
          return;
        }
      }
      await fail(j, r.message ?? "Google search failed.", "error");
      return;
    }
  }
}

let listening = false;
export async function initGoogle() {
  if (listening) return;
  listening = true;
  await onGoogleReport((r) => void handle(r));
}

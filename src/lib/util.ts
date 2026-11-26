import type { Conversation } from "./types";

export const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/** A conversation title from the first prompt: first line, cut at a word boundary. */
export function makeTitle(prompt: string, max = 70): string {
  const line = prompt.trim().split(/\n/)[0].replace(/\s+/g, " ").trim();
  if (!line) return "New search";
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,.;:!?-]+$/, "") + "…";
}

export function truncate(s: string, n: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

const DAY = 86_400_000;

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Sidebar group label for a timestamp, relative to `now`. */
export function dateGroup(ts: number, now = Date.now()): string {
  const today = startOfDay(now);
  if (ts >= today) return "Today";
  if (ts >= today - DAY) return "Yesterday";
  if (ts >= today - 7 * DAY) return "Previous 7 days";
  if (ts >= today - 30 * DAY) return "Previous 30 days";
  return new Date(ts).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function groupByDate(convs: Conversation[], now = Date.now()): { label: string; items: Conversation[] }[] {
  const groups: { label: string; items: Conversation[] }[] = [];
  for (const c of convs) {
    const label = dateGroup(c.updatedAt, now);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(c);
    else groups.push({ label, items: [c] });
  }
  return groups;
}

export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: d > 300 ? "numeric" : undefined });
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** Plain text from Markdown, good enough for previews and snippets. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/[*_~]{1,3}/g, "")
    .replace(/\\([*_`[\]\\])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform || navigator.userAgent);
export const modKey = isMac ? "⌘" : "Ctrl";
/** "⌘K" on macOS, "Ctrl+K" elsewhere. */
export const shortcut = (key: string): string => (isMac ? `⌘${key}` : `Ctrl+${key}`);

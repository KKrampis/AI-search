// Turn exported .md / .json files into conversations.
//
// Supported inputs, best first:
//   1. This app's own JSON conversations and Markdown exports (all turns restored).
//   2. Markdown exports of a search: "# Title", the answer, and an optional
//      trailing "References" / "Sources" section that becomes source cards.
//   3. JSON exports: any shape. Title from topic/title/query, the answer from
//      answer/content/markdown, or built from the remaining keys as Markdown.
//   4. A .md and .json with the same name are treated as one search:
//      Markdown answer (it keeps the full wording) + JSON sources and date.
//   Plain .txt files become a single search.

import type { Conversation, Message, Source } from "./types";
import { domainOf, makeTitle, uid } from "./util";

export interface ImportFileIn {
  path: string;
  name: string;
  content: string;
  modified: number;
}

export type ImportKind = "app" | "markdown" | "json" | "pair" | "text";

export interface ImportItem {
  key: string;
  files: string[]; // file names that produced this item
  kind: ImportKind;
  conversation: Conversation;
  warnings: string[];
  duplicate: boolean;
}

export interface ParsedImport {
  items: ImportItem[];
  errors: string[];
}

// ------------------------------------------------------------------ helpers

const SOURCE_HEADING = /^(references?|sources?|citations?|links?|bibliography|further reading)\b/i;
const URL_RE = /https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"]/;

function baseName(name: string): string {
  return name.replace(/\.(md|markdown|json|txt)$/i, "");
}

/** "grapheneos_vanadium-privacy" -> "Grapheneos vanadium privacy" */
export function humanize(s: string): string {
  const t = s.replace(/[_\-.]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1).toLowerCase() : "";
}

function cleanUrl(u: string): string {
  return u.replace(/[)>\]]+$/, "");
}

/** Parse one line of a references list into a source, if it holds a URL. */
export function parseSourceLine(line: string): Source | null {
  const l = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "").trim();
  if (!l) return null;
  const md = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(l);
  if (md) return { title: md[1].trim(), url: md[2] };
  const m = URL_RE.exec(l);
  if (!m) return null;
  const url = cleanUrl(m[0]);
  let title = (l.slice(0, m.index) + " " + l.slice(m.index + m[0].length))
    .replace(/<\s*>/g, "")
    .replace(/[\s:–—\-|(]+$/g, "")
    .replace(/^[\s:–—\-|]+/g, "")
    .replace(/\*\*|__/g, "")
    .trim();
  if (!/[\p{L}\p{N}]/u.test(title)) title = domainOf(url); // only punctuation left
  return { title, url };
}

function dedupeSources(list: Source[]): Source[] {
  const seen = new Set<string>();
  return list.filter((s) => (seen.has(s.url) ? false : (seen.add(s.url), true)));
}

function parseDate(v: unknown): number | null {
  if (typeof v === "number" && v > 0) return v < 1e12 ? v * 1000 : v; // seconds or ms
  if (typeof v === "string" && v.trim()) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function newConversation(title: string, question: string, answer: string, sources: Source[], date: number, origin: string): Conversation {
  const created = date;
  const messages: Message[] = [
    { id: uid(), role: "user", content: question.trim() || title, createdAt: created },
    {
      id: uid(),
      role: "assistant",
      content: answer.trim(),
      sources: dedupeSources(sources),
      createdAt: created + 1,
      status: "complete",
      note: `Imported from ${origin}`,
    },
  ];
  return {
    id: uid(),
    title: makeTitle(title || question, 90),
    projectId: null,
    createdAt: created,
    updatedAt: created + 1,
    starred: false,
    tags: ["imported"],
    googleUrl: null,
    messages,
  };
}

// ----------------------------------------------------------------- markdown

interface MdParts {
  title: string | null;
  body: string;
  sources: Source[];
  date: number | null;
}

/** Split a Markdown export into title, answer body and sources. */
export function parseMarkdownParts(md: string): MdParts {
  let text = md.replace(/\r\n?/g, "\n");
  let title: string | null = null;
  let date: number | null = null;

  // YAML front matter
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (fm) {
    for (const line of fm[1].split("\n")) {
      const m = /^(\w[\w-]*):\s*(.*)$/.exec(line);
      if (!m) continue;
      const v = m[2].replace(/^["']|["']$/g, "").trim();
      if (/^title$/i.test(m[1]) && v) title = v;
      if (/^(date|created)$/i.test(m[1])) date = parseDate(v);
    }
    text = text.slice(fm[0].length);
  }

  // First H1 (or Setext H1) is the title.
  const lines = text.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const h1 = /^#\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    const setext = i + 1 < lines.length && lines[i].trim() && /^=+\s*$/.test(lines[i + 1]);
    if (h1 || setext) {
      if (!title) title = (h1 ? h1[1] : lines[i]).trim();
      lines.splice(i, h1 ? 1 : 2);
      break;
    }
    if (lines[i].trim()) break; // the title must come before any content
  }

  // Trailing references section (any heading level, or a bold label line).
  const sources: Source[] = [];
  let cut = -1;
  inFence = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) inFence = !inFence;
    if (inFence) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    const label = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/.exec(lines[i]);
    const heading = h ? h[2] : label ? label[1] : null;
    if (heading && SOURCE_HEADING.test(heading.replace(/[*_:]/g, "").trim())) {
      // Must be followed only by list/URL lines (or another references block) until the end.
      const rest = lines.slice(i + 1);
      const nextHeading = rest.findIndex((l) => /^#{1,6}\s+/.test(l));
      const block = nextHeading >= 0 ? rest.slice(0, nextHeading) : rest;
      const parsed = block.map(parseSourceLine).filter((s): s is Source => !!s);
      if (parsed.length && nextHeading < 0) {
        sources.push(...parsed);
        cut = i;
        break;
      }
    }
  }
  const bodyLines = cut >= 0 ? lines.slice(0, cut) : lines;
  const body = bodyLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, body, sources, date };
}

/** This app's own Markdown export (markdown.rs): "## You" / "### Google AI Mode" turns. */
function parseAppMarkdown(md: string, file: ImportFileIn): Conversation | null {
  const text = md.replace(/\r\n?/g, "\n");
  if (!/\n## You\n/.test(text) || !/\n### Google AI Mode\n/.test(text)) return null;
  const title = /^#\s+(.+)$/m.exec(text)?.[1].trim() ?? humanize(baseName(file.name));
  const created = parseDate(/Created (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) UTC/.exec(text)?.[1]?.replace(" ", "T") + "Z") ?? file.modified;
  const chunks = text.split(/\n---\n\n## You\n\n/).slice(1);
  const messages: Message[] = [];
  let t = created;
  for (const chunk of chunks) {
    const [q, rest = ""] = chunk.split(/\n### Google AI Mode\n\n/);
    let answer = rest.replace(/\n---\n\n\[Open in Google\]\([^)]*\)\n?$/, "");
    const sources: Source[] = [];
    const si = answer.lastIndexOf("\n**Sources**\n");
    if (si >= 0) {
      for (const l of answer.slice(si).split("\n")) {
        const s = parseSourceLine(l);
        if (s) sources.push(s);
      }
      answer = answer.slice(0, si);
    }
    answer = answer.replace(/\n_Note: [^\n]*_\s*$/, "").replace(/^_\(no answer captured\)_$/m, "").trim();
    messages.push({ id: uid(), role: "user", content: q.trim(), createdAt: t++ });
    messages.push({ id: uid(), role: "assistant", content: answer, sources, createdAt: t++, status: "complete" });
  }
  if (!messages.length) return null;
  return {
    id: uid(),
    title,
    projectId: null,
    createdAt: created,
    updatedAt: t,
    starred: /· Starred/.test(text),
    tags: ["imported"],
    googleUrl: /\[Open in Google\]\(([^)]+)\)/.exec(text)?.[1] ?? null,
    messages,
  };
}

// --------------------------------------------------------------------- json

const TITLE_KEYS = ["title", "topic", "subject", "name", "heading"];
const QUESTION_KEYS = ["query", "question", "prompt", "search", "q"];
const ANSWER_KEYS = ["answer", "markdown", "content", "response", "text", "body", "result"];
const SUMMARY_KEYS = ["summary", "overview", "tldr", "tl_dr", "description", "intro", "introduction"];
const SOURCE_KEYS = ["sources", "references", "citations", "links", "refs"];
const DATE_KEYS = ["date", "created", "createdAt", "created_at", "timestamp", "time", "exportedAt"];

function pick(o: Record<string, unknown>, keys: string[]): [string, unknown] | null {
  for (const k of Object.keys(o)) if (keys.includes(k) || keys.includes(k.toLowerCase())) return [k, o[k]];
  return null;
}

function toSources(v: unknown): Source[] {
  if (!Array.isArray(v)) return [];
  const out: Source[] = [];
  for (const s of v) {
    if (typeof s === "string") {
      const p = parseSourceLine(s);
      if (p) out.push(p);
    } else if (s && typeof s === "object") {
      const o = s as Record<string, unknown>;
      const url = [o.url, o.link, o.href, o.uri].find((x) => typeof x === "string") as string | undefined;
      if (!url) continue;
      const title = [o.title, o.name, o.label, o.text, o.source].find((x) => typeof x === "string") as string | undefined;
      out.push({ title: title?.trim() || domainOf(url), url });
    }
  }
  return out;
}

function inline(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/** Render an arbitrary JSON value as Markdown (used for unknown keys). */
export function jsonToMarkdown(v: unknown, depth = 0): string {
  if (v === null || v === undefined) return "";
  if (typeof v !== "object") return inline(v);
  if (Array.isArray(v)) {
    return v
      .map((item) => {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          const entries = Object.entries(item as Record<string, unknown>);
          const strs = entries.filter(([, x]) => typeof x === "string" || typeof x === "number");
          if (strs.length && strs.length === entries.length) {
            const [head, ...rest] = strs.map(([, x]) => inline(x));
            return `- **${head}**${rest.length ? ": " + rest.join(" — ") : ""}`;
          }
          const nested = jsonToMarkdown(item, depth + 1).replace(/\n/g, "\n  ");
          return `- ${nested.replace(/^- /, "")}`;
        }
        return `- ${jsonToMarkdown(item, depth + 1).replace(/\n/g, "\n  ")}`;
      })
      .join("\n");
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.every(([, x]) => x === null || typeof x !== "object")) {
    return entries.map(([k, x]) => `- **${humanize(k)}:** ${inline(x)}`).join("\n");
  }
  if (depth >= 3) return "```json\n" + JSON.stringify(v, null, 2) + "\n```";
  const level = "#".repeat(Math.min(6, depth + 2));
  return entries
    .map(([k, x]) => (x !== null && typeof x === "object" ? `${level} ${humanize(k)}\n\n${jsonToMarkdown(x, depth + 1)}` : `**${humanize(k)}:** ${inline(x)}`))
    .join("\n\n");
}

interface JsonParts {
  title: string | null;
  question: string | null;
  body: string;
  sources: Source[];
  date: number | null;
}

export function parseJsonObject(o: Record<string, unknown>): JsonParts {
  const used = new Set<string>();
  const take = (keys: string[]) => {
    const p = pick(o, keys);
    if (p) used.add(p[0]);
    return p?.[1];
  };
  const titleV = take(TITLE_KEYS);
  const questionV = take(QUESTION_KEYS);
  const answerV = take(ANSWER_KEYS);
  const summaryV = take(SUMMARY_KEYS);
  const sourcesV = take(SOURCE_KEYS);
  const dateV = take(DATE_KEYS);

  let body = "";
  if (typeof answerV === "string" && answerV.trim()) {
    body = answerV.trim();
  } else {
    const parts: string[] = [];
    if (summaryV !== undefined) parts.push(jsonToMarkdown(summaryV));
    if (answerV !== undefined) parts.push(jsonToMarkdown(answerV));
    const rest = Object.entries(o).filter(([k]) => !used.has(k));
    const scalars = rest.filter(([, x]) => x === null || typeof x !== "object");
    const objects = rest.filter(([, x]) => x !== null && typeof x === "object");
    if (scalars.length) parts.push(scalars.map(([k, x]) => `- **${humanize(k)}:** ${inline(x)}`).join("\n"));
    for (const [k, x] of objects) parts.push(`## ${humanize(k)}\n\n${jsonToMarkdown(x, 1)}`);
    body = parts.filter(Boolean).join("\n\n");
  }
  return {
    title: typeof titleV === "string" ? titleV.trim() : null,
    question: typeof questionV === "string" ? questionV.trim() : null,
    body,
    sources: toSources(sourcesV),
    date: parseDate(dateV),
  };
}

function isAppConversation(o: unknown): o is Conversation {
  const c = o as Conversation;
  return !!c && typeof c === "object" && typeof c.id === "string" && typeof c.title === "string" && Array.isArray(c.messages) && typeof c.createdAt === "number";
}

// --------------------------------------------------------------------- main

function fingerprint(c: Conversation): string {
  const a = c.messages.find((m) => m.role === "assistant")?.content ?? "";
  return (c.title + "|" + a.replace(/\s+/g, " ").slice(0, 300)).toLowerCase();
}

/** Parse the files into import items. `existing` is used to flag duplicates. */
export function parseImport(files: ImportFileIn[], existing: Conversation[] = []): ParsedImport {
  const items: ImportItem[] = [];
  const errors: string[] = [];
  const known = new Set(existing.map((c) => c.id));
  const prints = new Set(existing.map(fingerprint));

  // Group a .md and a .json with the same base name.
  const groups = new Map<string, ImportFileIn[]>();
  for (const f of files) {
    const k = f.path.replace(/\.(md|markdown|json|txt)$/i, "").toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }

  const push = (c: Conversation, kind: ImportKind, from: ImportFileIn[], warnings: string[] = []) => {
    const dup = known.has(c.id) || prints.has(fingerprint(c));
    if (dup) warnings = [...warnings, "Already in your library"];
    items.push({ key: c.id, files: from.map((f) => f.name), kind, conversation: c, warnings, duplicate: dup });
  };

  for (const [, group] of groups) {
    const md = group.find((f) => /\.(md|markdown)$/i.test(f.name));
    const js = group.find((f) => /\.json$/i.test(f.name));
    const txt = group.find((f) => /\.txt$/i.test(f.name));

    // Parse JSON first: it may be an app conversation, a list, or a single search.
    let jsonParts: JsonParts | null = null;
    if (js) {
      let data: unknown;
      try {
        data = JSON.parse(js.content);
      } catch (e) {
        errors.push(`${js.name}: not valid JSON (${(e as Error).message})`);
      }
      if (data !== undefined) {
        const list = Array.isArray(data) ? data : [data];
        const objs = list.filter((x) => x && typeof x === "object" && !Array.isArray(x)) as Record<string, unknown>[];
        if (!objs.length) errors.push(`${js.name}: no searches found`);
        else if (objs.every(isAppConversation)) {
          for (const c of objs as unknown as Conversation[]) {
            const conv: Conversation = { ...c, tags: Array.from(new Set([...(c.tags ?? []), "imported"])) };
            // Searches that were running when exported can't be resumed.
            for (const m of conv.messages) if (m.status === "pending" || m.status === "needs_user") m.status = m.content ? "partial" : "stopped";
            push(conv, "app", [js]);
          }
        } else if (objs.length > 1 || Array.isArray(data)) {
          objs.forEach((o, i) => {
            const p = parseJsonObject(o);
            const title = p.title || p.question || `${humanize(baseName(js.name))} ${i + 1}`;
            push(newConversation(title, p.question || title, p.body, p.sources, p.date ?? js.modified, js.name), "json", [js]);
          });
        } else {
          jsonParts = parseJsonObject(objs[0]);
        }
      }
    }

    if (md) {
      const app = parseAppMarkdown(md.content, md);
      if (app) {
        push(app, "app", [md]);
        continue;
      }
      const p = parseMarkdownParts(md.content);
      const warnings: string[] = [];
      const title = p.title || jsonParts?.title || humanize(baseName(md.name));
      if (!p.title && !jsonParts?.title) warnings.push("No heading found — title taken from the file name");
      if (!p.body) warnings.push("Empty answer");
      const sources = p.sources.length ? [...p.sources, ...(jsonParts?.sources ?? [])] : (jsonParts?.sources ?? []);
      const date = p.date ?? jsonParts?.date ?? (js ? Math.min(md.modified, js.modified) : md.modified);
      const question = jsonParts?.question || title;
      const origin = js ? `${md.name} + ${js.name}` : md.name;
      push(newConversation(title, question, p.body, sources, date, origin), js && jsonParts ? "pair" : "markdown", js ? [md, js] : [md], warnings);
      continue;
    }

    if (jsonParts && js) {
      const title = jsonParts.title || jsonParts.question || humanize(baseName(js.name));
      const warnings = jsonParts.body ? [] : ["Empty answer"];
      push(newConversation(title, jsonParts.question || title, jsonParts.body, jsonParts.sources, jsonParts.date ?? js.modified, js.name), "json", [js], warnings);
      continue;
    }

    if (txt) {
      const body = txt.content.trim();
      if (!body) {
        errors.push(`${txt.name}: empty file`);
        continue;
      }
      const first = body.split("\n")[0].trim();
      const title = first.length <= 120 ? first : humanize(baseName(txt.name));
      const rest = first.length <= 120 ? body.slice(first.length).trim() : body;
      push(newConversation(title, title, rest || body, [], txt.modified, txt.name), "text", [txt]);
    }
  }

  items.sort((a, b) => b.conversation.createdAt - a.conversation.createdAt);
  return { items, errors };
}

import MiniSearch, { type SearchResult } from "minisearch";
import type { Conversation, Project } from "./types";
import { escapeHtml, stripMarkdown } from "./util";

interface Doc {
  id: string;
  title: string;
  body: string;
  tags: string;
  project: string;
}

export interface Hit {
  id: string;
  score: number;
  snippet: string; // HTML with <mark>
}

function toDoc(c: Conversation, projects: Map<string, Project>): Doc {
  return {
    id: c.id,
    title: c.title,
    body: c.messages.map((m) => stripMarkdown(m.content)).join("\n"),
    tags: (c.tags ?? []).join(" "),
    project: (c.projectId && projects.get(c.projectId)?.name) || "",
  };
}

/** Full-text index over every conversation (titles, prompts, answers, tags, project names). */
export class SearchIndex {
  private ms = this.fresh();
  private bodies = new Map<string, string>();

  private fresh() {
    return new MiniSearch<Doc>({
      fields: ["title", "body", "tags", "project"],
      storeFields: [],
      searchOptions: {
        boost: { title: 3, tags: 2, project: 1.5 },
        prefix: true,
        fuzzy: 0.15,
        combineWith: "AND",
      },
    });
  }

  rebuild(convs: Conversation[], projects: Project[]) {
    const pm = new Map(projects.map((p) => [p.id, p]));
    this.ms = this.fresh();
    this.bodies.clear();
    const docs = convs.map((c) => toDoc(c, pm));
    docs.forEach((d) => this.bodies.set(d.id, d.body));
    this.ms.addAll(docs);
  }

  upsert(c: Conversation, projects: Project[]) {
    const d = toDoc(c, new Map(projects.map((p) => [p.id, p])));
    if (this.ms.has(c.id)) this.ms.replace(d);
    else this.ms.add(d);
    this.bodies.set(c.id, d.body);
  }

  remove(id: string) {
    if (this.ms.has(id)) this.ms.discard(id);
    this.bodies.delete(id);
  }

  search(q: string, limit = 200): Hit[] {
    const query = q.trim();
    if (!query) return [];
    let results: SearchResult[] = this.ms.search(query);
    // Fall back to OR if nothing matches every term.
    if (!results.length) results = this.ms.search(query, { combineWith: "OR" });
    return results.slice(0, limit).map((r) => ({
      id: String(r.id),
      score: r.score,
      snippet: snippet(this.bodies.get(String(r.id)) ?? "", r.terms.length ? r.terms : query.split(/\s+/)),
    }));
  }
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ~180 chars of `text` around the first matched term, HTML-escaped, terms wrapped in <mark>. */
export function snippet(text: string, terms: string[], width = 180): string {
  const clean = terms.map((t) => t.trim()).filter((t) => t.length > 1);
  if (!text) return "";
  const lower = text.toLowerCase();
  let pos = -1;
  for (const t of clean) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (pos < 0 || i < pos)) pos = i;
  }
  let start = pos < 0 ? 0 : Math.max(0, pos - Math.floor(width / 3));
  if (start > 0) {
    const sp = text.indexOf(" ", start);
    if (sp > 0 && sp - start < 20) start = sp + 1;
  }
  let piece = text.slice(start, start + width);
  if (start + width < text.length) piece = piece.replace(/\s+\S*$/, "") + "…";
  if (start > 0) piece = "…" + piece;
  let html = escapeHtml(piece);
  if (clean.length) {
    const re = new RegExp(`(${clean.map((t) => escapeRe(escapeHtml(t))).join("|")})`, "gi");
    html = html.replace(re, "<mark>$1</mark>");
  }
  return html;
}

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { jsonToMarkdown, parseImport, parseMarkdownParts, parseSourceLine, type ImportFileIn } from "./importer";

const fixture = (name: string): ImportFileIn => ({
  path: `/exports/${name}`,
  name,
  content: readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  modified: Date.parse("2026-11-20T10:00:00Z"),
});
const MD = fixture("grapheneos_vanadium_privacy.md");
const JSON_ = fixture("grapheneos_vanadium_privacy.json");
const file = (name: string, content: string): ImportFileIn => ({ path: `/x/${name}`, name, content, modified: 1_700_000_000_000 });

describe("source lines", () => {
  it("reads the common shapes", () => {
    expect(parseSourceLine("* Reddit thread: https://reddit.com/r/x")).toEqual({ title: "Reddit thread", url: "https://reddit.com/r/x" });
    expect(parseSourceLine("1. [Docs](https://example.com/a)")).toEqual({ title: "Docs", url: "https://example.com/a" });
    expect(parseSourceLine("- https://www.example.org/page.")).toEqual({ title: "example.org", url: "https://www.example.org/page" });
    expect(parseSourceLine("- Title — <https://ex.com/p>")).toEqual({ title: "Title", url: "https://ex.com/p" });
    expect(parseSourceLine("- just text")).toBeNull();
  });
});

describe("markdown export", () => {
  it("splits title, answer and references", () => {
    const p = parseMarkdownParts(MD.content);
    expect(p.title).toBe("GrapheneOS Browser (Vanadium) Privacy Overview");
    expect(p.body.startsWith("The default browser on GrapheneOS is **Vanadium**")).toBe(true);
    expect(p.body).toContain("## Bottom Line");
    expect(p.body).not.toContain("References");
    expect(p.body).not.toContain("reddit.com");
    expect(p.sources).toEqual([
      { title: "Reddit r/GrapheneOS discussion on Vanadium privacy", url: "https://www.reddit.com/r/GrapheneOS/comments/1q1ezh1/is_vanadium_basically_the_most_private_browser_on/" },
      { title: "GrapheneOS forum discussion on webapps privacy & security", url: "https://discuss.grapheneos.org/d/29604-how-privatesecure-are-webapps" },
    ]);
  });

  it("keeps a sources heading that is followed by more content", () => {
    const p = parseMarkdownParts("# T\n\n## Sources of energy\n\n- https://a.com\n\n## More\n\ntext");
    expect(p.sources).toHaveLength(0);
    expect(p.body).toContain("Sources of energy");
  });

  it("reads front matter and bold reference labels", () => {
    const p = parseMarkdownParts("---\ntitle: \"From FM\"\ndate: 2025-01-02\n---\nAnswer.\n\n**Sources:**\n- https://x.com/1\n");
    expect(p.title).toBe("From FM");
    expect(p.date).toBe(Date.parse("2025-01-02"));
    expect(p.body).toBe("Answer.");
    expect(p.sources[0].url).toBe("https://x.com/1");
  });
});

describe("json export", () => {
  it("builds readable Markdown from an arbitrary shape", () => {
    const { items } = parseImport([JSON_]);
    expect(items).toHaveLength(1);
    const c = items[0].conversation;
    expect(c.title).toBe("GrapheneOS Default Browser Privacy");
    const a = c.messages[1];
    expect(a.content.startsWith("Vanadium offers strong baseline privacy")).toBe(true);
    expect(a.content).toContain("- **Browser:** Vanadium");
    expect(a.content).toContain("## Strengths");
    expect(a.content).toContain("- **Zero telemetry**: Built from Chromium");
    expect(a.content).toContain("## Limitations and tradeoffs");
    expect(a.content).toContain("- **Everyday browsing:** Vanadium paired with a private DNS service");
    expect(a.sources).toHaveLength(2);
    expect(items[0].kind).toBe("json");
  });

  it("renders nested values", () => {
    expect(jsonToMarkdown({ a: { b: 1 } })).toBe("## A\n\n- **B:** 1");
    expect(jsonToMarkdown(["x", "y"])).toBe("- x\n- y");
  });

  it("uses an answer field verbatim and imports arrays as many searches", () => {
    const { items } = parseImport([
      file("list.json", JSON.stringify([{ query: "q1", answer: "**a1**", date: "2024-05-01" }, { question: "q2", response: "a2", sources: ["https://s.com/x"] }])),
    ]);
    expect(items.map((i) => i.conversation.messages[0].content).sort()).toEqual(["q1", "q2"]);
    const one = items.find((i) => i.conversation.messages[0].content === "q1")!;
    expect(one.conversation.messages[1].content).toBe("**a1**");
    expect(one.conversation.createdAt).toBe(Date.parse("2024-05-01"));
  });

  it("reports invalid JSON", () => {
    const r = parseImport([file("bad.json", "{nope")]);
    expect(r.items).toHaveLength(0);
    expect(r.errors[0]).toMatch(/bad\.json: not valid JSON/);
  });
});

describe("pairs and app formats", () => {
  it("merges a .md and .json with the same name (Markdown answer, both sets of sources)", () => {
    const { items } = parseImport([MD, JSON_]);
    expect(items).toHaveLength(1);
    const it0 = items[0];
    expect(it0.kind).toBe("pair");
    expect(it0.files.sort()).toEqual(["grapheneos_vanadium_privacy.json", "grapheneos_vanadium_privacy.md"]);
    const c = it0.conversation;
    expect(c.title).toBe("GrapheneOS Browser (Vanadium) Privacy Overview");
    expect(c.messages[1].content).toContain("Because security is essential to privacy");
    expect(c.messages[1].sources).toHaveLength(2); // same URLs, de-duplicated
    expect(c.tags).toContain("imported");
    expect(c.createdAt).toBe(MD.modified);
  });

  it("restores this app's own JSON and flags duplicates", () => {
    const conv = {
      id: "c1", title: "Saved", projectId: null, createdAt: 5, updatedAt: 6, starred: true, tags: [],
      messages: [{ id: "m1", role: "user", content: "Q", createdAt: 5 }, { id: "m2", role: "assistant", content: "A", createdAt: 6, status: "complete" }],
    };
    const { items } = parseImport([file("c1.json", JSON.stringify(conv))], [conv as never]);
    expect(items[0].kind).toBe("app");
    expect(items[0].conversation.id).toBe("c1");
    expect(items[0].conversation.starred).toBe(true);
    expect(items[0].duplicate).toBe(true);
  });

  it("restores every turn from this app's Markdown export", () => {
    const md = `# Tauri question\n\n> Created 2026-11-26 15:00 UTC · Starred\n\n---\n\n## You\n\nWhat is Tauri?\n\n### Google AI Mode\n\nA **toolkit**.\n\n**Sources**\n\n1. [Tauri](https://v2.tauri.app/)\n\n---\n\n## You\n\nHow big?\n\n### Google AI Mode\n\nAbout 5 MB.\n\n---\n\n[Open in Google](https://www.google.com/search?q=x)\n`;
    const { items } = parseImport([file("t.md", md)]);
    const c = items[0].conversation;
    expect(items[0].kind).toBe("app");
    expect(c.messages.map((m) => m.content)).toEqual(["What is Tauri?", "A **toolkit**.", "How big?", "About 5 MB."]);
    expect(c.messages[1].sources).toEqual([{ title: "Tauri", url: "https://v2.tauri.app/" }]);
    expect(c.starred).toBe(true);
    expect(c.googleUrl).toBe("https://www.google.com/search?q=x");
    expect(c.createdAt).toBe(Date.parse("2026-11-26T15:00Z"));
  });

  it("imports plain text and headingless markdown", () => {
    const { items } = parseImport([file("note.txt", "Question line\nanswer body"), file("my-notes_file.md", "Just an answer.")]);
    const txt = items.find((i) => i.kind === "text")!.conversation;
    expect(txt.title).toBe("Question line");
    expect(txt.messages[1].content).toBe("answer body");
    const md = items.find((i) => i.kind === "markdown")!;
    expect(md.conversation.title).toBe("My notes file");
    expect(md.warnings[0]).toMatch(/file name/);
  });
});

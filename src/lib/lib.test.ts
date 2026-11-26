import { describe, expect, it } from "vitest";
import { SearchIndex, snippet } from "./search";
import { slug } from "./slug";
import type { Conversation } from "./types";
import { dateGroup, makeTitle, stripMarkdown } from "./util";

const conv = (id: string, title: string, answer: string, extra: Partial<Conversation> = {}): Conversation => ({
  id,
  title,
  projectId: null,
  createdAt: 1,
  updatedAt: 1,
  starred: false,
  tags: [],
  messages: [
    { id: id + "u", role: "user", content: title, createdAt: 1 },
    { id: id + "a", role: "assistant", content: answer, createdAt: 2 },
  ],
  ...extra,
});

describe("util", () => {
  it("makes short titles", () => {
    expect(makeTitle("  hello\nworld ")).toBe("hello");
    const t = makeTitle("a ".repeat(10) + "really long question that keeps going on and on and on forever and ever");
    expect(t.length).toBeLessThanOrEqual(71);
    expect(t.endsWith("…")).toBe(true);
    expect(makeTitle("")).toBe("New search");
  });

  it("groups dates", () => {
    const now = new Date("2026-11-26T15:00:00").getTime();
    expect(dateGroup(now - 1000, now)).toBe("Today");
    expect(dateGroup(now - 86_400_000, now)).toBe("Yesterday");
    expect(dateGroup(now - 3 * 86_400_000, now)).toBe("Previous 7 days");
  });

  it("strips markdown", () => {
    expect(stripMarkdown("## Title\n- **bold** [link](http://x) `code`")).toBe("Title bold link code");
  });

  it("slugs like the Rust side", () => {
    expect(slug("Hello, World! Ünïcode")).toBe("hello-world-n-code");
    expect(slug("   ")).toBe("untitled");
  });
});

describe("search", () => {
  const idx = new SearchIndex();
  idx.rebuild(
    [
      conv("1", "Tauri vs Electron", "Tauri uses the **system webview** and Rust."),
      conv("2", "Sourdough starter", "Feed the starter twice a day with flour and water.", { projectId: "p" }),
      conv("3", "Rust lifetimes", "Lifetimes describe how long references are valid."),
    ],
    [{ id: "p", name: "Baking", description: "", instructions: "", createdAt: 1, updatedAt: 1 }],
  );

  it("finds by answer text with prefix + fuzzy matching", () => {
    expect(idx.search("webvie")[0].id).toBe("1");
    expect(idx.search("flours")[0].id).toBe("2"); // fuzzy
    expect(idx.search("baking")[0].id).toBe("2"); // project name
  });

  it("ranks title matches first", () => {
    const hits = idx.search("rust");
    expect(hits[0].id).toBe("3");
    expect(hits.map((h) => h.id)).toContain("1");
  });

  it("highlights snippets safely", () => {
    const s = snippet("Use <script> tags carefully with Tauri apps", ["tauri"]);
    expect(s).toContain("&lt;script&gt;");
    expect(s).toContain("<mark>Tauri</mark>");
  });

  it("supports upsert and remove", () => {
    idx.upsert(conv("4", "Kubernetes ingress", "An ingress routes HTTP traffic."), []);
    expect(idx.search("ingress")[0].id).toBe("4");
    idx.remove("4");
    expect(idx.search("ingress")).toHaveLength(0);
  });
});

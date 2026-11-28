// Runs the real Google bridge script (src-tauri/src/bridge/google_bridge.js)
// inside jsdom against a page shaped like Google AI Mode.

import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const BRIDGE = readFileSync(new URL("../../src-tauri/src/bridge/google_bridge.js", import.meta.url), "utf8");

const PAGE = `<!doctype html><html><body>
<header><a href="https://accounts.google.com">Sign in</a></header>
<div role="main">
  <div data-subtree="aimc">
    <div class="q">what is tauri</div>
    <div><span>Tauri is a toolkit for building <b>small, fast</b> desktop apps with a web frontend.</span></div>
    <h3>Key points</h3>
    <ul>
      <li>Uses the system webview (<code>WebKit</code> on macOS/Linux)</li>
      <li>Backend in Rust
        <ul><li>Commands are invoked over IPC</li></ul>
      </li>
    </ul>
    <table><tr><th>Toolkit</th><th>Size</th></tr><tr><td>Tauri</td><td>~5 MB</td></tr><tr><td>Electron</td><td>~120 MB</td></tr></table>
    <p>Read more at <a href="https://www.google.com/url?q=https://v2.tauri.app/start/&amp;sa=U">the docs</a>.</p>
    <button aria-label="Copy">Copy</button>
    <div aria-hidden="true">hidden chrome</div>
  </div>
  <div class="panel">
    <a href="https://github.com/tauri-apps/tauri?utm_source=x" aria-label="tauri-apps/tauri on GitHub">GitHub</a>
    <a href="https://maps.google.com/">Maps</a>
  </div>
  <textarea aria-label="Ask a follow up"></textarea>
</div>
</body></html>`;

function load(html = PAGE, url = "https://www.google.com/search?udm=50&q=what+is+tauri") {
  const reports: any[] = [];
  const dom = new JSDOM(html, { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window as any;
  w.__TAURI_INTERNALS__ = { invoke: (_cmd: string, args: any) => (reports.push(args.report), Promise.resolve()) };
  // jsdom has no layout: give elements a size so the input finder accepts them.
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 300, height: 40, top: 0, left: 0, right: 300, bottom: 40 });
  w.eval(BRIDGE);
  return { w, reports, bridge: w.__aisBridge };
}

const job = (over: Record<string, unknown> = {}) => ({
  jobId: "j1",
  prompt: "what is tauri",
  selectors: ['div[data-subtree="aimc"]'],
  inputSelectors: ['textarea[aria-label*="follow" i]', "textarea"],
  prior: [],
  priorLinks: [],
  ...over,
});

describe("google bridge", () => {
  it("reports ready on load", () => {
    const { reports } = load();
    expect(reports[0]).toMatchObject({ kind: "ready", jobId: null });
  });

  it("converts the AI Mode answer to Markdown", () => {
    const { bridge } = load();
    const { markdown, fallback } = bridge._test.extractNew(job());
    expect(fallback).toBe(false);
    expect(markdown).not.toMatch(/^what is tauri/); // echoed question is stripped
    expect(markdown).toContain("Tauri is a toolkit for building **small, fast** desktop apps");
    expect(markdown).toContain("#### Key points");
    expect(markdown).toContain("- Uses the system webview (`WebKit` on macOS/Linux)");
    expect(markdown).toMatch(/- Backend in Rust\n\s+- Commands are invoked over IPC/);
    expect(markdown).toContain("| Toolkit | Size |");
    expect(markdown).toContain("| Electron | ~120 MB |");
    expect(markdown).toContain("[the docs](https://v2.tauri.app/start/)");
    expect(markdown).not.toContain("hidden chrome");
    expect(markdown).not.toContain("Copy");
  });

  it("collects external sources and unwraps Google redirects", () => {
    const { w, bridge } = load();
    const roots = Array.from(w.document.querySelectorAll('div[data-subtree="aimc"]'));
    const sources = bridge._test.collectSources(job(), roots);
    const urls = sources.map((s: any) => s.url);
    expect(urls).toContain("https://v2.tauri.app/start/");
    expect(urls).toContain("https://github.com/tauri-apps/tauri");
    expect(urls.some((u: string) => u.includes("google.com"))).toBe(false);
    expect(sources.find((s: any) => s.url.includes("github"))!.title).toBe("tauri-apps/tauri on GitHub");
  });

  it("only returns the new turn after a follow-up", () => {
    const { w, bridge } = load();
    const first = bridge._test.extractNew(job()).markdown;
    // Simulate AI Mode appending a second turn container.
    const turn = w.document.createElement("div");
    turn.setAttribute("data-subtree", "aimc");
    turn.innerHTML = "<p>how big is it</p><p>A minimal Tauri app bundle is usually a few megabytes.</p>";
    w.document.querySelector('[role="main"]').appendChild(turn);
    const fresh = bridge._test.extractNew(job({ prompt: "how big is it", prior: [w.__aisBridge.toMarkdown(w.document.querySelector('[data-subtree="aimc"]'))] }));
    expect(first.length).toBeGreaterThan(50);
    expect(fresh.markdown).toBe("A minimal Tauri app bundle is usually a few megabytes.");
  });

  it("handles a single container that grows", () => {
    const { w, bridge } = load();
    const root = w.document.querySelector('[data-subtree="aimc"]');
    const before = w.__aisBridge.toMarkdown(root);
    const p = w.document.createElement("p");
    p.textContent = "Follow-up answer text that was appended to the same container.";
    root.appendChild(p);
    const { markdown } = bridge._test.extractNew(job({ prompt: "x", prior: [before] }));
    expect(markdown).toBe("Follow-up answer text that was appended to the same container.");
  });

  it("returns nothing new while the old turn is unchanged", () => {
    const { w, bridge } = load();
    const before = w.__aisBridge.toMarkdown(w.document.querySelector('[data-subtree="aimc"]'));
    expect(bridge._test.extractNew(job({ prior: [before] })).markdown).toBe("");
  });

  it("falls back to the main region when no selector matches", () => {
    const { bridge } = load();
    const r = bridge._test.extractNew(job({ selectors: [".does-not-exist"] }));
    expect(r.fallback).toBe(true);
    expect(r.markdown).toContain("Tauri is a toolkit");
  });

  it("refuses Google's basic (heirloom) home page instead of capturing it", async () => {
    // Shape of the page Google served the macOS WebKit default user agent (from a real snapshot).
    const BASIC = `<!doctype html><html><head><script>window.google={sn:"webhp",kHL:"en"};</script></head><body>
      <div id="gb"><a href="https://mail.google.com/mail/">Gmail</a><a href="https://accounts.google.com/ServiceLogin">Sign in</a></div>
      <center><form action="/search" name="f"><input class="lst" name="q"><input class="lsb" value="Google Search" name="btnG" type="submit">
      <input class="lsb" value="I'm Feeling Lucky" name="btnI" type="submit"></form>
      <span id="footer"><a href="/intl/en/ads/">Advertising</a></span></center></body></html>`;
    const payload = Buffer.from(JSON.stringify(job({ jobId: "jb", timeoutSecs: 30, stableMs: 800 }))).toString("base64url");
    const { bridge, reports } = load(BASIC, `https://www.google.com/webhp?hl=en#__ais=${payload}`);
    expect(bridge._test.basicPage()).toBe(true);
    await new Promise((r) => setTimeout(r, 600));
    const err = reports.find((r) => r.kind === "error");
    expect(err).toMatchObject({ jobId: "jb", code: "basic_page" });
    expect(reports.some((r) => r.kind === "done" || r.kind === "partial")).toBe(false);
    expect(load().bridge._test.basicPage()).toBe(false);
  });

  it("detects CAPTCHA and consent pages", () => {
    expect(load("<html><body><form id='captcha-form'></form></body></html>", "https://www.google.com/sorry/index").bridge._test.blockedReason()).toBe("captcha");
    expect(load("<html><body></body></html>", "https://consent.google.com/ml").bridge._test.blockedReason()).toBe("consent");
    expect(load().bridge._test.blockedReason()).toBe(null);
  });

  it("types follow-ups into AI Mode's input and reports submission", async () => {
    const { w, bridge, reports } = load();
    let typed = "";
    w.document.querySelector("textarea").addEventListener("input", (e: any) => (typed = e.target.value));
    bridge.followUp(job({ jobId: "j2", prompt: "and what about mobile?" }));
    expect(typed).toBe("and what about mobile?");
    await new Promise((r) => setTimeout(r, 450));
    expect(reports.some((r) => r.kind === "submitted" && r.jobId === "j2")).toBe(true);
    bridge.cancel();
  });

  it("reports no_input when there is no follow-up box", () => {
    const { bridge, reports } = load(PAGE.replace(/<textarea[^>]*><\/textarea>/, ""));
    bridge.followUp(job({ jobId: "j3", inputSelectors: ["textarea"] }));
    expect(reports.at(-1)).toMatchObject({ kind: "error", code: "no_input", jobId: "j3" });
  });

  it("picks up a job from the URL fragment and finishes it", async () => {
    const payload = Buffer.from(JSON.stringify(job({ jobId: "j4", timeoutSecs: 30, stableMs: 800 }))).toString("base64url");
    const { w, reports } = load(PAGE, `https://www.google.com/search?udm=50&q=what+is+tauri#__ais=${payload}`);
    expect(w.location.hash).toBe(""); // fragment is stripped
    await new Promise((r) => setTimeout(r, 3600));
    const done = reports.find((r) => r.kind === "done");
    expect(done).toBeTruthy();
    expect(done.jobId).toBe("j4");
    expect(done.markdown).toContain("Tauri is a toolkit");
    expect(done.sources.length).toBeGreaterThan(0);
  }, 10_000);
});

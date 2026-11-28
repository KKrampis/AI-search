/*
 * AI Search — Google AI Mode bridge.
 *
 * Injected (as a Tauri initialization script) into every page loaded in the
 * dedicated "google" window. It never runs in the app's own UI.
 *
 * Responsibilities
 *   1. Pick up a job handed over in the URL fragment (#__ais=<base64 json>)
 *      when the app navigates to https://www.google.com/search?udm=50&q=...
 *   2. Type follow-up prompts into AI Mode's own input box (followUp()).
 *   3. Watch the page until the answer stops changing, convert it to
 *      Markdown, collect source links, and report back to the app through
 *      the single IPC command this window is allowed to call: `bridge_report`.
 *   4. Detect CAPTCHA / consent pages so the app can show the window to you.
 *
 * Google changes its markup regularly. The answer container and input box
 * are located with selectors passed in from Settings → Google → Advanced, with
 * generic fallbacks, so most breakages can be fixed without a rebuild.
 */
(function () {
  "use strict";
  if (window.top !== window) return;
  if (window.__aisBridge) return;

  var JOB_KEY = "__ais_job";
  var LOG = "[ai-search]";

  // ------------------------------------------------------------------ IPC
  function send(report) {
    var t = window.__TAURI_INTERNALS__;
    if (!t || typeof t.invoke !== "function") {
      console.warn(LOG, "IPC unavailable; report dropped", report && report.kind);
      return;
    }
    try {
      t.invoke("bridge_report", { report: report }).catch(function (e) {
        console.warn(LOG, "report failed", e);
      });
    } catch (e) {
      console.warn(LOG, "report threw", e);
    }
  }

  // ------------------------------------------------------------ job state
  function decodeJob(b64) {
    var s = b64.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = atob(s);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function saveJob(job) {
    try { sessionStorage.setItem(JOB_KEY, JSON.stringify(job)); } catch (e) { /* ignore */ }
  }
  function loadJob() {
    try {
      var raw = sessionStorage.getItem(JOB_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearJob() {
    try { sessionStorage.removeItem(JOB_KEY); } catch (e) { /* ignore */ }
  }

  (function takeJobFromHash() {
    var m = /[#&]__ais=([^&]+)/.exec(location.hash || "");
    if (!m) return;
    try {
      var job = decodeJob(m[1]);
      job.startedAt = Date.now();
      job.prior = job.prior || [];
      job.priorLinks = job.priorLinks || [];
      saveJob(job);
    } catch (e) {
      console.warn(LOG, "bad job fragment", e);
    }
    try {
      history.replaceState(history.state, "", location.href.replace(/#.*$/, ""));
    } catch (e) { /* ignore */ }
  })();

  // ------------------------------------------------------------ utilities
  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, SVG: 1, BUTTON: 1, TEXTAREA: 1, INPUT: 1,
    SELECT: 1, TEMPLATE: 1, IFRAME: 1, IMG: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1,
    FORM: 1, NAV: 1, HEADER: 1, FOOTER: 1, DIALOG: 1, OPTION: 1, PICTURE: 1,
  };
  var BLOCK_TAGS = {
    P: 1, DIV: 1, SECTION: 1, ARTICLE: 1, MAIN: 1, ASIDE: 1, FIGURE: 1,
    FIGCAPTION: 1, DL: 1, DT: 1, DD: 1, ADDRESS: 1, DETAILS: 1, SUMMARY: 1,
  };

  function isGoogleHost(host) {
    return /(^|\.)(google|gstatic|googleusercontent|googleapis|youtube|ggpht|withgoogle)\.[a-z.]+$/i.test(host);
  }

  function hidden(el) {
    if (el.getAttribute && el.getAttribute("aria-hidden") === "true") return true;
    if (el.hidden) return true;
    var role = el.getAttribute && el.getAttribute("role");
    if (role === "navigation" || role === "dialog" || role === "progressbar" || role === "button") return true;
    if (typeof el.checkVisibility === "function") {
      try { if (!el.checkVisibility()) return true; } catch (e) { /* ignore */ }
    } else {
      var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return true;
    }
    return false;
  }

  function isBlock(el) {
    if (BLOCK_TAGS[el.tagName]) {
      // Google uses <div style="display:inline"> and friends; respect CSS.
      var d = getComputedStyle(el).display;
      return !(d === "inline" || d === "contents");
    }
    if (el.tagName === "SPAN") {
      var ds = getComputedStyle(el).display;
      return ds === "block" || ds === "flex" || ds === "grid" || ds === "list-item";
    }
    return false;
  }

  function cleanUrl(href) {
    try {
      var u = new URL(href, location.href);
      if (isGoogleHost(u.hostname) && u.pathname === "/url") {
        var q = u.searchParams.get("q") || u.searchParams.get("url");
        if (q) u = new URL(q);
      }
      if (u.protocol !== "http:" && u.protocol !== "https:") return null;
      // Drop scroll-to-text fragments and tracking params.
      u.hash = u.hash.indexOf(":~:") >= 0 ? "" : u.hash;
      ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "srsltid", "ved", "usg"].forEach(function (k) {
        u.searchParams.delete(k);
      });
      return u.toString();
    } catch (e) {
      return null;
    }
  }

  function isExternal(url) {
    try { return !isGoogleHost(new URL(url).hostname); } catch (e) { return false; }
  }

  // --------------------------------------------------- DOM -> Markdown
  function escInline(s) {
    return s.replace(/([*_`\[\]])/g, "\\$1");
  }

  function inlineText(node) {
    // Single-line text for table cells / link labels.
    return (node.textContent || "").replace(/\s+/g, " ").trim();
  }

  // Emphasis markers must hug the text: "a **b** c", never "a ** b ** c".
  function wrap(raw, marker) {
    var t = raw.trim();
    if (!t) return raw;
    return (/^\s/.test(raw) ? " " : "") + marker + t + marker + (/\s$/.test(raw) ? " " : "");
  }

  function toMarkdown(root) {
    var out = convert(root, { list: [], pre: false });
    // Tidy whitespace outside fenced code blocks.
    return out
      .split(/(\n```[\s\S]*?\n```)/)
      .map(function (part, i) {
        if (i % 2) return part;
        return part.replace(/(\S) {2,}(?=\S)/g, "$1 ").replace(/[ \t]+\n/g, "\n");
      })
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\s+|\s+$/g, "");
  }

  function convert(node, ctx) {
    if (node.nodeType === 3) {
      if (ctx.pre) return node.nodeValue;
      return escInline(node.nodeValue.replace(/\s+/g, " "));
    }
    if (node.nodeType !== 1) return "";
    var el = node;
    var tag = el.tagName;
    if (SKIP_TAGS[tag] || hidden(el)) return "";

    var kids = function (c) {
      var s = "";
      for (var n = el.firstChild; n; n = n.nextSibling) s += convert(n, c || ctx);
      return s;
    };

    switch (tag) {
      case "BR": return "\n";
      case "HR": return "\n\n---\n\n";
      case "H1": case "H2": case "H3": case "H4": case "H5": case "H6": {
        var lvl = Math.min(6, Number(tag[1]) + 1); // answers rarely need H1
        var t = kids().replace(/\s+/g, " ").trim();
        return t ? "\n\n" + "#".repeat(lvl) + " " + t + "\n\n" : "";
      }
      case "STRONG": case "B": return wrap(kids(), "**");
      case "EM": case "I": return wrap(kids(), "*");
      case "CODE": {
        if (ctx.pre) return el.textContent;
        var c = el.textContent.replace(/`/g, "ˋ");
        return c ? "`" + c + "`" : "";
      }
      case "PRE": {
        var lang = "";
        var codeEl = el.querySelector("code");
        if (codeEl) {
          var m = /language-([\w+-]+)/.exec(codeEl.className || "");
          if (m) lang = m[1];
        }
        return "\n\n```" + lang + "\n" + el.textContent.replace(/\n+$/, "") + "\n```\n\n";
      }
      case "A": {
        var label = kids().replace(/\s+/g, " ").trim();
        var url = cleanUrl(el.getAttribute("href") || "");
        if (!label) return "";
        if (url && isExternal(url)) return "[" + label + "](" + url + ")";
        return label;
      }
      case "UL": case "OL": {
        var depth = ctx.list.length;
        var ordered = tag === "OL";
        var n = 0;
        var s = "";
        for (var li = el.firstElementChild; li; li = li.nextElementSibling) {
          if (hidden(li)) continue;
          n++;
          var marker = ordered ? n + ". " : "- ";
          var body = convert(li, { list: ctx.list.concat([marker]), pre: false, inLi: true })
            .replace(/^\s+|\s+$/g, "")
            .replace(/\n{2,}/g, "\n");
          if (!body) continue;
          var indent = "  ".repeat(depth);
          s += indent + marker + body.replace(/\n/g, "\n" + indent + "  ") + "\n";
        }
        return s ? "\n\n" + s + "\n" : "";
      }
      case "LI": {
        if (ctx.inLi) return kids({ list: ctx.list, pre: false });
        var single = kids().trim();
        return single ? "\n- " + single + "\n" : "";
      }
      case "TABLE": return tableToMd(el);
      case "BLOCKQUOTE": {
        var q = kids().trim();
        return q ? "\n\n" + q.split("\n").map(function (l) { return "> " + l; }).join("\n") + "\n\n" : "";
      }
      default: {
        var inner = kids(ctx.inLi ? { list: ctx.list, pre: false } : null);
        if (isBlock(el)) return "\n\n" + inner + "\n\n";
        return inner;
      }
    }
  }

  function tableToMd(table) {
    var rows = [];
    table.querySelectorAll("tr").forEach(function (tr) {
      if (hidden(tr)) return;
      var cells = [];
      tr.querySelectorAll("th,td").forEach(function (td) {
        cells.push(inlineText(td).replace(/\|/g, "\\|"));
      });
      if (cells.length) rows.push(cells);
    });
    if (!rows.length) return "";
    var width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    rows = rows.map(function (r) { while (r.length < width) r.push(""); return r; });
    var lines = ["| " + rows[0].join(" | ") + " |", "|" + " --- |".repeat(width)];
    for (var i = 1; i < rows.length; i++) lines.push("| " + rows[i].join(" | ") + " |");
    return "\n\n" + lines.join("\n") + "\n\n";
  }

  // ------------------------------------------------------ page analysis
  function queryAll(selectors) {
    var out = [];
    (selectors || []).forEach(function (sel) {
      try {
        document.querySelectorAll(sel).forEach(function (el) {
          if (out.indexOf(el) < 0) out.push(el);
        });
      } catch (e) { /* invalid selector from settings */ }
    });
    // Outermost matches only, in document order.
    out = out.filter(function (el) {
      return !out.some(function (o) { return o !== el && o.contains(el); });
    });
    out.sort(function (a, b) {
      return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return out;
  }

  function fallbackRoot() {
    return document.querySelector('[role="main"]') || document.getElementById("center_col") ||
      document.getElementById("rcnt") || document.querySelector("main") || document.body;
  }

  function currentAnswers(job) {
    var roots = queryAll(job.selectors);
    if (roots.length) return { roots: roots, fallback: false };
    return { roots: [fallbackRoot()], fallback: true };
  }

  /** Return the Markdown of the answer to *this* prompt (excluding earlier turns). */
  function extractNew(job) {
    var found = currentAnswers(job);
    var prior = job.prior || [];
    var mds = found.roots.map(toMarkdown);
    var md = "";
    // Walk from the last container backwards: the newest turn is at the end.
    for (var i = mds.length - 1; i >= 0; i--) {
      var cur = mds[i];
      if (!cur) continue;
      if (prior.indexOf(cur) >= 0 || isOldTurn(cur, prior)) { md = ""; break; } // old turn: nothing new yet
      var grown = null;
      for (var j = 0; j < prior.length; j++) {
        if (prior[j] && cur.length > prior[j].length && cur.indexOf(prior[j]) === 0) {
          grown = cur.slice(prior[j].length);
          break;
        }
      }
      md = grown !== null ? grown : cur;
      break;
    }
    md = stripEcho(md, job.prompt);
    return { markdown: md.trim(), fallback: found.fallback, roots: found.roots };
  }

  // An earlier turn that was re-rendered slightly differently (e.g. its
  // suggestion chips disappeared) must not be mistaken for the new answer.
  function isOldTurn(cur, prior) {
    var head = cur.slice(0, 200);
    for (var j = 0; j < prior.length; j++) {
      var p = prior[j];
      if (p && p.slice(0, 200) === head && cur.length <= p.length + 40) return true;
    }
    return false;
  }

  function stripEcho(md, prompt) {
    if (!md || !prompt) return md || "";
    var p = prompt.replace(/\s+/g, " ").trim();
    var lines = md.split("\n");
    // Drop leading lines that just repeat the question.
    while (lines.length && (lines[0].trim() === "" || lines[0].replace(/\s+/g, " ").replace(/\\/g, "").trim() === p)) lines.shift();
    return lines.join("\n");
  }

  function collectSources(job, roots) {
    var seen = {};
    var prior = {};
    (job.priorLinks || []).forEach(function (u) { prior[u] = 1; });
    var out = [];
    var add = function (a) {
      var url = cleanUrl(a.getAttribute("href") || "");
      if (!url || !isExternal(url) || prior[url] || seen[url]) return;
      seen[url] = 1;
      var title = (a.getAttribute("aria-label") || inlineText(a) || "").trim();
      if (title.length > 160) title = title.slice(0, 157) + "…";
      if (!title) { try { title = new URL(url).hostname.replace(/^www\./, ""); } catch (e) { title = url; } }
      out.push({ title: title, url: url });
    };
    roots.forEach(function (r) { r.querySelectorAll("a[href]").forEach(add); });
    // Source cards often live in a side panel outside the answer container.
    document.querySelectorAll("a[href]").forEach(add);
    return out.slice(0, 40);
  }

  function allExternalLinks() {
    var out = [];
    document.querySelectorAll("a[href]").forEach(function (a) {
      var u = cleanUrl(a.getAttribute("href") || "");
      if (u && isExternal(u) && out.indexOf(u) < 0) out.push(u);
    });
    return out;
  }

  function blockedReason() {
    var host = location.hostname;
    if (/^consent\./.test(host) || document.querySelector('form[action*="consent"]')) return "consent";
    if (location.pathname.indexOf("/sorry") === 0 || document.getElementById("captcha-form") ||
        document.querySelector('iframe[src*="recaptcha"], form[action*="sorry"]')) return "captcha";
    if (/^accounts\./.test(host)) return "signin";
    return null;
  }

  /**
   * Google's stripped-down pages for unrecognised browsers ("heirloom"): no
   * AI Mode, so capturing them would only save the home page or plain links.
   */
  function basicPage() {
    var g = window.google;
    if (g && (g.sn === "webhp" || g.sn === "heirloom-hp")) return true;
    if (document.querySelector('form[name="f"] input.lst, input.lsb[name="btnI"]')) return true;
    var pmc = g && g.pmc && g.pmc.sb_he;
    return !!(pmc && /heirloom/.test(pmc.client || ""));
  }

  function basicPageError(job) {
    stopWatching();
    clearJob();
    send({ jobId: job.jobId, kind: "error", code: "basic_page", url: location.href,
      message: "Google served its basic page, which has no AI Mode. This happens when Google doesn't recognise the browser: " +
        "check Settings → Google → Advanced → User agent (leave it empty for the Safari default), then try again." });
  }

  function looksBusy(roots) {
    for (var i = 0; i < roots.length; i++) {
      if (roots[i].querySelector('[aria-busy="true"], [role="progressbar"]')) return true;
    }
    return false;
  }

  var PLACEHOLDER = /^(thinking|searching|looking|generating|working|analy[sz]ing|gathering|reading)\b/i;

  // ------------------------------------------------------------ watcher
  var watcher = null;

  function stopWatching() {
    if (watcher) { clearInterval(watcher.timer); watcher = null; }
  }

  function watch(job) {
    stopWatching();
    var state = { last: "", lastChange: Date.now(), lastSent: "", lastSentAt: 0, blockedSent: null };
    var timeoutMs = Math.max(15, job.timeoutSecs || 120) * 1000;
    var stableMs = Math.max(800, job.stableMs || 3000);

    var tick = function () {
      var reason = blockedReason();
      if (reason) {
        if (state.blockedSent !== reason) {
          state.blockedSent = reason;
          send({ jobId: job.jobId, kind: "needs_user", code: reason, url: location.href,
            message: reason === "captcha" ? "Google wants to verify you're human. Solve the check in the Google window; the search continues automatically."
              : reason === "consent" ? "Google is asking for cookie consent. Choose an option in the Google window; the search continues automatically."
              : "Google is asking you to sign in. Finish in the Google window, then retry." });
        }
        // Keep the job: after the CAPTCHA Google redirects back and we resume.
        job.startedAt = Date.now();
        saveJob(job);
        return;
      }
      state.blockedSent = null;

      if (basicPage()) return basicPageError(job);

      var res;
      try { res = extractNew(job); } catch (e) {
        console.warn(LOG, "extract failed", e);
        return;
      }
      var md = res.markdown;
      var now = Date.now();
      if (md !== state.last) {
        state.last = md;
        state.lastChange = now;
      }
      var meaningful = md.length >= 20 && !(md.length < 120 && PLACEHOLDER.test(md));

      if (meaningful && md !== state.lastSent && now - state.lastSentAt > 700) {
        state.lastSent = md;
        state.lastSentAt = now;
        send({ jobId: job.jobId, kind: "partial", markdown: md, url: location.href });
      }

      var stable = now - state.lastChange >= stableMs;
      var age = now - job.startedAt;
      if (meaningful && stable && !looksBusy(res.roots) && age > 2500) {
        finish(job, md, res, false);
      } else if (age > timeoutMs) {
        if (meaningful) finish(job, md, res, true);
        else {
          stopWatching();
          clearJob();
          send({ jobId: job.jobId, kind: "error", code: "timeout", url: location.href,
            message: "No AI Mode answer appeared within " + Math.round(timeoutMs / 1000) +
              "s. AI Mode may be unavailable for this query, account or region — open the Google window to check." });
        }
      }
    };
    watcher = { job: job, timer: setInterval(tick, 400) };
    tick();
  }

  function finish(job, md, res, timedOut) {
    stopWatching();
    clearJob();
    var notes = [];
    if (res.fallback) notes.push("Answer container not found; captured with a generic fallback (check Settings → Google → Advanced).");
    if (timedOut) notes.push("Stopped waiting after the timeout; the answer may be incomplete.");
    send({
      jobId: job.jobId,
      kind: "done",
      markdown: md,
      sources: collectSources(job, res.roots),
      url: location.href,
      partial: timedOut,
      note: notes.join(" ") || null,
    });
  }

  // ------------------------------------------------------ follow-ups
  function findInput(selectors) {
    for (var i = 0; i < (selectors || []).length; i++) {
      var list;
      try { list = document.querySelectorAll(selectors[i]); } catch (e) { continue; }
      for (var k = list.length - 1; k >= 0; k--) {
        var el = list[k];
        if (el.disabled || el.readOnly) continue;
        if (el.closest && el.closest('[aria-hidden="true"]')) continue;
        var r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 10) continue;
        return el;
      }
    }
    return null;
  }

  function setValue(el, text) {
    el.focus();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      var proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, text);
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      // contenteditable
      var sel = window.getSelection();
      var range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      if (!document.execCommand("insertText", false, text)) el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
  }

  function findSubmit(input) {
    var scope = input.closest("form") || input.parentElement;
    for (var up = 0; up < 6 && scope; up++) {
      var btn = scope.querySelector(
        'button[aria-label*="send" i], button[aria-label*="submit" i], [role="button"][aria-label*="send" i], [role="button"][aria-label*="submit" i], button[type="submit"]'
      );
      if (btn && !btn.disabled && btn.getAttribute("aria-disabled") !== "true") return btn;
      scope = scope.parentElement;
    }
    return null;
  }

  function pressEnter(el) {
    var opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function followUp(job) {
    var reason = blockedReason();
    if (reason) {
      send({ jobId: job.jobId, kind: "needs_user", code: reason, url: location.href,
        message: "Google needs your attention in the Google window before it can continue." });
      return;
    }
    if (basicPage()) return basicPageError(job);
    var input = findInput(job.inputSelectors);
    if (!input) {
      send({ jobId: job.jobId, kind: "error", code: "no_input", url: location.href,
        message: "Couldn't find AI Mode's follow-up box on the current Google page." });
      return;
    }
    // Remember what is already on the page so only the new turn is captured.
    var found = currentAnswers(job);
    job.prior = found.roots.map(toMarkdown).filter(Boolean);
    job.priorLinks = allExternalLinks();
    job.startedAt = Date.now();
    saveJob(job); // survives a full page navigation, if AI Mode does one

    setValue(input, job.prompt);
    setTimeout(function () {
      var btn = findSubmit(input);
      if (btn) btn.click();
      else {
        pressEnter(input);
        var form = input.closest("form");
        if (form && typeof form.requestSubmit === "function") {
          try { form.requestSubmit(); } catch (e) { /* ignore */ }
        }
      }
      send({ jobId: job.jobId, kind: "submitted", url: location.href });
      watch(job);
    }, 350);
  }

  // ------------------------------------------------------- public API
  window.__aisBridge = {
    version: 1,
    followUp: followUp,
    cancel: function () { stopWatching(); clearJob(); },
    debugDump: function () {
      send({ jobId: null, kind: "debug", url: location.href, html: document.documentElement.outerHTML });
    },
    toMarkdown: toMarkdown,
    // Exposed for the unit tests (src/lib/bridge.test.ts).
    _test: { basicPage: basicPage, extractNew: extractNew, collectSources: collectSources, cleanUrl: cleanUrl, blockedReason: blockedReason, findInput: findInput },
  };

  function onReady() {
    var job = loadJob();
    send({ jobId: job ? job.jobId : null, kind: "ready", url: location.href, blocked: blockedReason() });
    if (job) watch(job);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", onReady, { once: true });
  else onReady();
})();

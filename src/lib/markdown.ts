import { Marked } from "marked";
import DOMPurify from "dompurify";

const marked = new Marked({ gfm: true, breaks: false, async: false });

/** Render answer Markdown to sanitized HTML. */
export function renderMarkdown(md: string): string {
  const html = marked.parse(md || "") as string;
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ["style", "form", "input", "button", "iframe", "img"],
    FORBID_ATTR: ["style"],
  });
}

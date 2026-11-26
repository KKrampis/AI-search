/** File-name friendly slug (mirrors library::slug in Rust). */
export function slug(s: string, max = 60): string {
  let out = "";
  let dash = false;
  for (const ch of s) {
    if (/[A-Za-z0-9]/.test(ch)) {
      out += ch.toLowerCase();
      dash = false;
    } else if (!dash && out) {
      out += "-";
      dash = true;
    }
    if (out.length >= max) break;
  }
  out = out.replace(/^-+|-+$/g, "");
  return out || "untitled";
}

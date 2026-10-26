import fs from "fs";
import path from "path";

/** Public pages that must share the homepage's header and footer. */
export const CHROME_PAGES = ["about.html", "services.html", "gallery.html", "contact.html"];

const CHROME_MARKERS = {
  header: { start: "<!-- chrome:header:start -->", end: "<!-- chrome:header:end -->" },
  footer: { start: "<!-- chrome:footer:start -->", end: "<!-- chrome:footer:end -->" },
} as const;

type ChromeTag = keyof typeof CHROME_MARKERS;

function markerSpan(src: string, tag: ChromeTag): { start: number; end: number; inner: string } | null {
  const { start, end } = CHROME_MARKERS[tag];
  const s = src.indexOf(start);
  if (s < 0) return null;
  const e = src.indexOf(end, s + start.length);
  if (e < 0) return null;
  return { start: s, end: e + end.length, inner: src.slice(s + start.length, e) };
}

/** Locate the first <header> or last <footer> when the markers are absent. */
function findChromeElement(src: string, tag: ChromeTag): { start: number; end: number } | null {
  const lower = src.toLowerCase();
  if (tag === "header") {
    const m = /<header\b/i.exec(src);
    if (!m) return null;
    const close = lower.indexOf("</header>", m.index);
    if (close < 0) return null;
    return { start: m.index, end: close + "</header>".length };
  }
  const close = lower.lastIndexOf("</footer>");
  if (close < 0) return null;
  const open = lower.lastIndexOf("<footer", close);
  if (open < 0) return null;
  return { start: open, end: close + "</footer>".length };
}

function extractChrome(src: string, tag: ChromeTag): { html: string; marked: boolean } | null {
  const span = markerSpan(src, tag);
  if (span) return { html: span.inner.trim(), marked: true };
  const el = findChromeElement(src, tag);
  if (!el) return null;
  return { html: src.slice(el.start, el.end).trim(), marked: false };
}

/** In-page anchors (#menu) only work on the homepage; from another page they
 * must point at /#menu. Empty href="#" is left for the runtime. */
function scopeChromeLinks(block: string): string {
  return block.replace(/\bhref="#([^"\s]+)"/g, 'href="/#$1"');
}

/** Mark this page's nav link, and clear any current-page mark coming from the
 * homepage chrome. Matches clean ("contact", "/contact") and ".html" hrefs. */
function setCurrentPage(block: string, page: string): string {
  const bare = block.replace(/\saria-current="page"/gi, "");
  const clean = page.replace(/\.html$/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return bare.replace(new RegExp(`(<a\\b[^>]*\\bhref="(?:\\/)?${clean}(?:\\.html)?"[^>]*)>`, "i"), '$1 aria-current="page">');
}

function replaceChrome(src: string, tag: ChromeTag, inner: string): string {
  const { start, end } = CHROME_MARKERS[tag];
  const wrapped = `${start}\n${inner}\n${end}`;
  const span = markerSpan(src, tag);
  if (span) return src.slice(0, span.start) + wrapped + src.slice(span.end);
  const el = findChromeElement(src, tag);
  if (el) return src.slice(0, el.start) + wrapped + src.slice(el.end);
  return src;
}

/**
 * The homepage is the single source of truth for the site's menu and footer.
 * Secondary pages are locked (the agent cannot edit them), so without this the
 * header/footer drift apart on every build. Runs after every agent turn and
 * after the repair turn, before QA.
 */
export function syncChrome(workspace: string): { pages: number; skipped: string[] } {
  const indexPath = path.join(workspace, "index.html");
  if (!fs.existsSync(indexPath)) return { pages: 0, skipped: ["index.html missing"] };
  let indexHtml = fs.readFileSync(indexPath, "utf8");

  const chrome: Partial<Record<ChromeTag, string>> = {};
  let indexChanged = false;
  for (const tag of ["header", "footer"] as const) {
    const found = extractChrome(indexHtml, tag);
    if (!found) continue;
    chrome[tag] = found.html;
    if (!found.marked) {
      // Stamp markers into the homepage so later syncs are exact even after a
      // refactor that keeps the same header/footer markup.
      const el = findChromeElement(indexHtml, tag);
      if (el) {
        const { start, end } = CHROME_MARKERS[tag];
        indexHtml =
          indexHtml.slice(0, el.start) +
          `${start}\n${indexHtml.slice(el.start, el.end)}\n${end}` +
          indexHtml.slice(el.end);
        indexChanged = true;
      }
    }
  }
  if (indexChanged) fs.writeFileSync(indexPath, indexHtml);

  const skipped: string[] = [];
  if (!chrome.header) skipped.push("no header found");
  if (!chrome.footer) skipped.push("no footer found");
  if (!chrome.header || !chrome.footer) return { pages: 0, skipped };

  let pages = 0;
  for (const page of CHROME_PAGES) {
    const p = path.join(workspace, page);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, "utf8");
    let next = replaceChrome(src, "header", setCurrentPage(scopeChromeLinks(chrome.header), page));
    next = replaceChrome(next, "footer", scopeChromeLinks(chrome.footer).replace(/\saria-current="page"/gi, ""));
    if (next !== src) {
      fs.writeFileSync(p, next);
      pages++;
    }
  }
  return { pages, skipped };
}

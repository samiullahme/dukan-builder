#!/usr/bin/env node
"use strict";

/**
 * Deterministic QA gate for a generated site workspace.
 * Usage: node qa-check.cjs <workspace> [--out <dir>] [--no-browser]
 *
 * Static checks need no dependencies. Browser checks activate automatically
 * when the `playwright` package and its Chromium build are available.
 */

const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const workspace = path.resolve(args[0] || process.cwd());
const outFlag = args.indexOf("--out");
const noBrowser = args.includes("--no-browser");

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

const siteSlug = path.basename(workspace);
const outDir = outFlag >= 0 && args[outFlag + 1]
  ? path.resolve(args[outFlag + 1])
  : path.join("/opt/qa", siteSlug, stamp());

fs.mkdirSync(outDir, { recursive: true });

const report = {
  workspace,
  outDir,
  startedAt: new Date().toISOString(),
  static: { checks: [] },
  browser: null,
  counts: { errors: 0, warnings: 0 },
};

function add(level, check, message, detail) {
  const entry = { level, check, message, detail };
  if (level === "error") report.counts.errors++;
  if (level === "warn") report.counts.warnings++;
  report.static.checks.push(entry);
  const tag = level === "error" ? "FAIL" : level === "warn" ? "WARN" : "ok  ";
  console.log(`[${tag}] ${check}: ${message}`);
}

function ok(check, message) {
  add("info", check, message);
}

function read(file) {
  return fs.readFileSync(path.join(workspace, file), "utf8");
}

function exists(file) {
  try {
    return fs.statSync(path.join(workspace, file)).isFile();
  } catch {
    return false;
  }
}

const PLACEHOLDERS = [
  "Your Business Name",
  "Your street, Your city",
  "0300 0000000",
  "A short line about what makes your shop special",
  "Tell your customers who you are",
  "Service one",
  "Describe what you offer",
  "Mon–Sat, 9am – 9pm",
  "__SITE_SLUG__",
];

const CATEGORIES = ["restaurant", "salon", "clinic", "retail", "real-estate", "other"];

function hexColor(v) {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* ---------------- image helpers ---------------- */

function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { format: "png", w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { format: "gif", w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o + 9 < buf.length) {
      if (buf[o] !== 0xff) {
        o++;
        continue;
      }
      const marker = buf[o + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { format: "jpeg", h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      }
      const len = buf.readUInt16BE(o + 2);
      if (len < 2) break;
      o += 2 + len;
    }
    return null;
  }
  if (buf.slice(0, 4).toString() === "RIFF" && buf.slice(8, 12).toString() === "WEBP") {
    const kind = buf.slice(12, 16).toString();
    if (kind === "VP8 ") return { format: "webp", w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") {
      const bits = buf.readUInt32LE(21);
      return { format: "webp", w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X") {
      return {
        format: "webp",
        w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)),
        h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)),
      };
    }
  }
  return null;
}

async function fetchImage(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { Accept: "image/jpeg,image/png,image/webp;q=0.9,*/*;q=0.1" },
    });
    const type = res.headers.get("content-type") || "";
    let buf = Buffer.alloc(0);
    if (res.body) {
      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      while (total < 65536) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        total += value.length;
      }
      reader.cancel().catch(() => {});
      buf = Buffer.concat(chunks);
    }
    return { status: res.status, type, bytes: buf.length, size: imageSize(buf), finalUrl: res.url };
  } finally {
    clearTimeout(timer);
  }
}

async function checkImage(label, url, minW, minH) {
  if (!url || typeof url !== "string") {
    add("error", "image:" + label, "missing image URL");
    return;
  }
  // Media downloaded into the workspace ships with the published site; verify
  // the bytes on disk instead of fetching a remote URL.
  if (url.startsWith("/")) {
    const file = path.join(workspace, url);
    let buf;
    try {
      buf = fs.readFileSync(file);
    } catch {
      add("error", "image:" + label, `local media file missing: ${url}`);
      return;
    }
    const size = imageSize(buf);
    if (!size) {
      add("error", "image:" + label, `local file is not a readable image: ${url}`);
      return;
    }
    if (size.w < minW || size.h < minH) {
      add("warn", "image:" + label, `small image ${size.w}x${size.h} (want >= ${minW}x${minH}): ${url}`);
      return;
    }
    ok("image:" + label, `${size.format} ${size.w}x${size.h} (local)`);
    return;
  }
  if (!/^https:\/\//.test(url)) {
    add("error", "image:" + label, "not an https URL: " + url);
    return;
  }
  try {
    const r = await fetchImage(url);
    if (r.status !== 200 && r.status !== 206) {
      add("error", "image:" + label, `HTTP ${r.status} for ${url}`);
      return;
    }
    if (!/^image\//i.test(r.type) && !r.size) {
      add("error", "image:" + label, `content-type "${r.type}" and the bytes are not a known image (${url})`);
      return;
    }
    if (!/^image\//i.test(r.type)) {
      add("warn", "image:" + label, `served as "${r.type}" but the bytes are a valid ${r.size.format} image (${url})`);
      return;
    }
    if (!r.size) {
      add("warn", "image:" + label, `could not read dimensions (${r.type}): ${url}`);
      return;
    }
    if (r.size.w < minW || r.size.h < minH) {
      add("warn", "image:" + label, `small image ${r.size.w}x${r.size.h} (want >= ${minW}x${minH}): ${url}`);
      return;
    }
    ok("image:" + label, `${r.size.format} ${r.size.w}x${r.size.h}`);
  } catch (e) {
    add("error", "image:" + label, `fetch failed: ${e.message} (${url})`);
  }
}

/* ---------------- required files ---------------- */

const REQUIRED = [
  "index.html", "about.html", "services.html", "gallery.html", "contact.html",
  "login.html", "admin-login.html", "dashboard.html", "admin.html",
  "styles.css", "pages.css", "dashboard.css",
  "theme.js", "site.js", "categories.js", "store.js", "forms.js",
  "auth.js", "admin-login.js", "dashboard.js", "admin.js",
  "site.json",
];
const missing = REQUIRED.filter((f) => !exists(f));
if (missing.length) add("error", "files", "missing required file(s): " + missing.join(", "));
else ok("files", `${REQUIRED.length} required files present`);

/* ---------------- site.json ---------------- */

let site = null;
try {
  site = JSON.parse(read("site.json"));
  ok("site.json", "parses");
} catch (e) {
  add("error", "site.json", "missing or invalid JSON: " + e.message);
}

const HTML_PAGES = ["index.html", "about.html", "services.html", "gallery.html", "contact.html", "login.html", "admin-login.html", "dashboard.html", "admin.html"];

if (site) {
  const name = String(site.business_name || "").trim();
  if (!name) add("error", "field:business_name", "empty");
  else if (PLACEHOLDERS.includes(name)) add("error", "field:business_name", "placeholder value: " + name);
  else ok("field:business_name", name);

  const slug = String(site.slug || "").trim();
  if (!/^[a-z0-9-]{2,60}$/.test(slug)) add("error", "field:slug", "invalid slug: " + slug);
  else ok("field:slug", slug);

  const category = String(site.category || "");
  if (!CATEGORIES.includes(category)) add("error", "field:category", "unknown category: " + category);
  else ok("field:category", category);

  const digits = String(site.phone || "").replace(/\D/g, "");
  if (digits.length < 10) add("error", "field:phone", "not a usable phone number: " + site.phone);
  else ok("field:phone", site.phone);

  if (!String(site.address || "").trim()) add("error", "field:address", "empty");
  if (!String(site.hours || "").trim()) add("error", "field:hours", "empty");

  const about = String(site.about || "").trim();
  if (about.length < 40) add("warn", "field:about", `too short (${about.length} chars)`);
  if (PLACEHOLDERS.some((p) => about.includes(p))) add("error", "field:about", "contains placeholder text");

  const tagline = String(site.tagline || "").trim();
  if (!tagline) add("error", "field:tagline", "empty");
  else if (PLACEHOLDERS.some((p) => tagline.includes(p))) add("error", "field:tagline", "contains placeholder text");
  else if (tagline.length > 160) add("warn", "field:tagline", `too long (${tagline.length} chars)`);
  else ok("field:tagline", tagline);

  const pal = site.palette || {};
  for (const key of ["primary", "accent", "bg"]) {
    if (!hexColor(pal[key])) add("error", "palette:" + key, "not a #rrggbb colour: " + pal[key]);
  }
  if (hexColor(pal.primary) && hexColor(pal.bg)) {
    const ratio = contrast(pal.primary, pal.bg);
    if (ratio < 3) add("warn", "palette:contrast", `primary on bg is only ${ratio.toFixed(2)}:1`);
    else ok("palette", `primary/bg contrast ${ratio.toFixed(2)}:1`);
  }

  // The reference palette is authoritative: the site.json palette must stay the
  // one derived from design/plan.json (the agent may not swap brand colours).
  if (exists("design/plan.json")) {
    try {
      const plan = JSON.parse(read("design/plan.json"));
      const planPal = Array.isArray(plan.color_palette) ? plan.color_palette : [];
      const hexes = planPal.filter(hexColor);
      if (hexes.length >= 2) {
        let expectedPrimary = hexes[0];
        if (luminance(expectedPrimary) > 0.65) {
          expectedPrimary = [...hexes].sort((a, b) => luminance(a) - luminance(b))[0];
        }
        if (hexColor(pal.primary) && pal.primary.toLowerCase() !== expectedPrimary.toLowerCase()) {
          add("error", "palette:plan", `site.json primary ${pal.primary} does not match the reference palette's dominant colour ${expectedPrimary}`);
        } else {
          ok("palette:plan", `primary ${expectedPrimary} matches the reference analysis`);
        }
      }
    } catch (e) {
      add("warn", "palette:plan", "could not read design/plan.json: " + e.message);
    }
  }

  const services = Array.isArray(site.services) ? site.services : [];
  if (services.length === 0) add("error", "services", "empty");
  if (services.length > 9) add("warn", "services", `${services.length} services (max 9)`);
  const names = new Set();
  services.forEach((s, i) => {
    const n = String(s.name || "").trim();
    if (!n) add("error", `services[${i}].name`, "empty");
    if (PLACEHOLDERS.includes(n)) add("error", `services[${i}].name`, "placeholder: " + n);
    if (names.has(n.toLowerCase())) add("warn", `services[${i}].name`, "duplicate: " + n);
    names.add(n.toLowerCase());
    if (!String(s.desc || "").trim()) add("warn", `services[${i}].desc`, "empty description");
  });
  if (services.length && services.every((s) => String(s.name || "").trim() && String(s.desc || "").trim())) {
    ok("services", `${services.length} services with names and descriptions`);
  }

  if (!site.hero_image) add("error", "media:hero", "hero_image is empty");
  if (!site.about_image) add("error", "media:about", "about_image is empty");
  const gallery = Array.isArray(site.gallery) ? site.gallery.filter(Boolean) : [];
  if (gallery.length < 3) add("error", "media:gallery", `only ${gallery.length} gallery image(s); want >= 3`);
  else ok("media:gallery", `${gallery.length} gallery images`);
  if (!Array.isArray(site.media_credits) || site.media_credits.length === 0) {
    add("warn", "media:credits", "no media credits (attribution will be missing)");
  }

  // The slug must be baked into every page for per-site demo data isolation.
  for (const page of HTML_PAGES) {
    if (!exists(page)) continue;
    const h = read(page);
    if (h.includes("__SITE_SLUG__")) add("error", "slug:" + page, "unreplaced __SITE_SLUG__ placeholder");
    const meta = h.match(/<meta name="dukan-site" content="([^"]*)"/);
    if (!meta) add("warn", "slug:" + page, "missing dukan-site meta");
    else if (meta[1] !== slug) add("error", "slug:" + page, `meta slug "${meta[1]}" != site.json "${slug}"`);
  }
}

/* ---------------- markup contracts ---------------- */

const html = exists("index.html") ? read("index.html") : "";
const css = exists("styles.css") ? read("styles.css") : "";
const js = exists("site.js") ? read("site.js") : "";

if (html) {
  if (html.length < 2000) add("warn", "index.html", `suspiciously small (${html.length} bytes)`);
  for (const slot of ["business_name", "tagline", "phone", "address", "hours", "about"]) {
    if (!new RegExp(`data-slot="${slot}"`).test(html)) add("error", "slot:" + slot, "no data-slot element");
  }
  for (const slot of ["hero_image", "about_image"]) {
    if (!new RegExp(`data-slot-src="${slot}"`).test(html)) add("error", "slot:" + slot, "no data-slot-src element");
  }
  if (!/data-slot-href="tel:phone"/.test(html)) add("error", "slot:tel", "no tel: phone link");
  if (!/data-slot-href="wa:phone"/.test(html)) add("error", "slot:wa", "no WhatsApp link");
  if (!/id="services-grid"/.test(html)) add("error", "slot:services", "no #services-grid");
  if (!/id="gallery-grid"/.test(html)) add("error", "slot:gallery", "no #gallery-grid");
  if (!/id="newsletter-form"/.test(html)) add("error", "slot:newsletter", "no footer newsletter form");
  if (!/class="[^"]*js-auth-link/.test(html)) add("error", "slot:auth-link", "no .js-auth-link");
  if (!/data-slot-attr="content:tagline"/.test(html)) add("warn", "meta:description", "no hydrated meta description");
  if (!/<meta name="viewport"/.test(html)) add("error", "meta:viewport", "missing viewport meta");
  for (const page of ["about.html", "services.html", "gallery.html", "contact.html", "login.html"]) {
    if (!html.includes(`href="${page}"`)) add("error", "nav:" + page, "homepage does not link to " + page);
  }
  if (!/href="contact\.html#book"/.test(html)) add("error", "nav:book", "no link to contact.html#book");
  for (const script of ["theme.js", "site.js", "categories.js", "store.js", "forms.js"]) {
    if (!html.includes(script)) add("error", "script:" + script, "homepage does not load " + script);
  }

  const emoji = html.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu);
  if (emoji) add("error", "design:emoji", "emoji characters in markup: " + [...new Set(emoji)].join(" "));

  const inlineScripts = (html.match(/<script\b(?![^>]*\bsrc=)[^>]*>/g) || []).length;
  if (inlineScripts > 2) add("warn", "design:inline-js", `${inlineScripts} inline script blocks`);
}

/* ---------------- shared header/footer ---------------- */

function chromeBlock(src, tag) {
  const markers = tag === "header"
    ? ["<!-- chrome:header:start -->", "<!-- chrome:header:end -->"]
    : ["<!-- chrome:footer:start -->", "<!-- chrome:footer:end -->"];
  const s = src.indexOf(markers[0]);
  if (s >= 0) {
    const e = src.indexOf(markers[1], s + markers[0].length);
    if (e >= 0) return src.slice(s + markers[0].length, e);
  }
  if (tag === "header") {
    const m = /<header\b[\s\S]*?<\/header>/i.exec(src);
    return m ? m[0] : "";
  }
  const lower = src.toLowerCase();
  const close = lower.lastIndexOf("</footer>");
  if (close < 0) return "";
  const open = lower.lastIndexOf("<footer", close);
  return open >= 0 ? src.slice(open, close + "</footer>".length) : "";
}

function normChrome(block) {
  return String(block)
    .replace(/\saria-current="[^"]*"/gi, "")
    .replace(/\bhref="index\.html#([^"]+)"/g, 'href="#$1"')
    .replace(/>\s+</g, "><")
    .replace(/\s+/g, " ")
    .trim();
}

if (html) {
  if (!/href="pages\.css"/.test(html)) {
    add("error", "chrome:css", "index.html must load pages.css so the shared header/footer is styled the same on every page");
  }
  const refHeader = normChrome(chromeBlock(html, "header"));
  const refFooter = normChrome(chromeBlock(html, "footer"));
  if (!refHeader) add("error", "chrome:header", "no header found on the homepage");
  if (!refFooter) add("error", "chrome:footer", "no footer found on the homepage");
  let chromeDrift = 0;
  for (const page of ["about.html", "services.html", "gallery.html", "contact.html"]) {
    if (!exists(page)) continue;
    const src = read(page);
    for (const [tag, ref] of [["header", refHeader], ["footer", refFooter]]) {
      if (!ref) continue;
      if (normChrome(chromeBlock(src, tag)) !== ref) {
        chromeDrift++;
        add("error", `chrome:${tag}:${page}`, `the ${tag} differs from the homepage — the menu and footer must be identical on every page`);
      }
    }
  }
  if (refHeader && refFooter && !chromeDrift) ok("chrome", "header and footer match on all public pages");
}

const contact = exists("contact.html") ? read("contact.html") : "";if (contact) {
  for (const id of ["booking-form", "booking-success", "inquiry-form", "inquiry-success"]) {
    if (!contact.includes(`id="${id}"`)) add("error", "form:" + id, "missing #" + id);
  }
  if (!/data-booking-fields/.test(contact)) add("error", "form:fields", "missing [data-booking-fields]");
  for (const script of ["theme.js", "site.js", "categories.js", "store.js", "forms.js"]) {
    if (!contact.includes(script)) add("error", "contact-script:" + script, "contact page does not load " + script);
  }
}

const dashboard = exists("dashboard.html") ? read("dashboard.html") : "";
const admin = exists("admin.html") ? read("admin.html") : "";
if (dashboard) {
  for (const id of ["my-requests", "requests-empty", "profile-form"]) {
    if (!dashboard.includes(`id="${id}"`)) add("error", "dashboard:" + id, "missing #" + id);
  }
  for (const script of ["store.js", "categories.js", "dashboard.js"]) {
    if (!dashboard.includes(script)) add("error", "dashboard-script:" + script, "dashboard does not load " + script);
  }
  if (!/dashboard\.css/.test(dashboard)) add("error", "dashboard:css", "dashboard does not load dashboard.css");
}
if (admin) {
  for (const id of ["admin-requests", "admin-search", "status-filter", "export-csv", "subscriber-list"]) {
    if (!admin.includes(`id="${id}"`)) add("error", "admin:" + id, "missing #" + id);
  }
  for (const script of ["store.js", "categories.js", "admin.js"]) {
    if (!admin.includes(script)) add("error", "admin-script:" + script, "admin does not load " + script);
  }
  if (!/dashboard\.css/.test(admin)) add("error", "admin:css", "admin does not load dashboard.css");
  if (/demo mode|owner@site\.local|owner123/i.test(admin)) add("error", "admin:demo", "admin page still shows demo sign-in text");
}

const adminLogin = exists("admin-login.html") ? read("admin-login.html") : "";
if (adminLogin) {
  for (const id of ["admin-login-form", "admin-username", "admin-password"]) {
    if (!adminLogin.includes(`id="${id}"`)) add("error", "admin-login:" + id, "missing #" + id);
  }
  if (!/admin-login\.js/.test(adminLogin)) add("error", "admin-login:script", "owner sign-in page does not load admin-login.js");
  if (!/dashboard\.css/.test(adminLogin)) add("error", "admin-login:css", "owner sign-in page does not load dashboard.css");
  if (/type="email"/.test(adminLogin)) add("error", "admin-login:email", "owner sign-in asks for an email instead of the generated username");
}

const loginPage = exists("login.html") ? read("login.html") : "";
if (loginPage) {
  if (/demo-box|demo-fill|owner@site\.local|owner123/i.test(loginPage)) {
    add("error", "login:demo", "customer login page still shows demo account buttons");
  }
}

if (css) {
  for (const token of ["--primary", "--accent", "--bg"]) {
    if (!css.includes(token + ":")) add("error", "tokens:" + token, "not defined in CSS");
  }
  const wrap = css.match(/\.wrap\s*\{[^}]*padding:\s*([^;}]+)/);
  if (wrap) {
    const horiz = wrap[1].split(/\s+/).map((v) => parseFloat(v)).filter(Boolean);
    const px = horiz.length >= 2 ? horiz[1] : horiz[0];
    if (!px || px < 16) add("warn", "layout:padding", `.wrap horizontal padding is ${px || 0}px (want >= 16px)`);
    else ok("layout:padding", `.wrap horizontal padding ${px}px`);
  } else {
    add("warn", "layout:padding", "could not find .wrap padding rule");
  }
  const gradients = css.match(/(?:linear|radial)-gradient\([^)]*\)/g) || [];
  const purpleBlue = gradients.filter((g) => {
    const hexes = g.match(/#[0-9a-f]{6}/gi) || [];
    return hexes.some((h) => {
      const n = parseInt(h.slice(1), 16);
      const r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
      return b > 150 && b > r * 1.25 && b > gg * 1.1;
    });
  });
  if (purpleBlue.length) add("warn", "design:gradient", `purple/blue gradient(s): ${purpleBlue[0].slice(0, 80)}…`);
  if (!/font-family/.test(css)) add("error", "design:font", "no font-family declared");
  if (!/color-mix|var\(--primary\)/.test(css)) add("warn", "design:tokens", "tokens are not actually used");
}

if (js) {
  if (!/site\.json/.test(js)) add("error", "script:hydration", "site.js does not fetch site.json");
  if (!/data-slot-attr/.test(js)) add("warn", "script:hydration", "data-slot-attr is not hydrated");
  if (/document\.write/.test(js)) add("warn", "script:safety", "uses document.write");
  if (!/media_credits/.test(js)) add("warn", "script:credits", "media credits are not rendered");
}

/* ---------------- run ---------------- */

function normTokens(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 2);
}

function sharedTokens(a, b) {
  return a.filter((t) => b.includes(t));
}

function sharedWeight(a, b) {
  return sharedTokens(a, b).reduce((sum, t) => sum + t.length, 0);
}

/** Two names match when they share substantial wording (length-weighted). */
function namesMatch(a, b) {
  const ta = Array.isArray(a) ? a : normTokens(a);
  const tb = Array.isArray(b) ? b : normTokens(b);
  return sharedWeight(ta, tb) >= 8;
}

function parseBriefServices(raw) {
  const items = [];
  const lines = String(raw || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // "Name — Rs. 320 — desc" (one item per line)
    const single = line.match(/^(.+?)\s*[—–]\s*Rs\.?\s*([\d,]+)/i);
    if (single) {
      if (single[1].trim().length >= 2) items.push({ name: single[1].trim(), price: parseInt(single[2].replace(/,/g, ""), 10) });
      continue;
    }
    // "Rs. 320 — desc" (price line under a name line)
    const priceOnly = line.match(/^Rs\.?\s*([\d,]+)/i);
    if (priceOnly) {
      const prev = items[items.length - 1];
      if (prev && prev.price === null) prev.price = parseInt(priceOnly[1].replace(/,/g, ""), 10);
      continue;
    }
    const inline = line.match(/Rs\.?\s*([\d,]+)/i);
    const name = (inline ? line.slice(0, inline.index) : line).replace(/[—–]\s*$/, "").trim();
    if (name.length >= 2) items.push({ name, price: inline ? parseInt(inline[1].replace(/,/g, ""), 10) : null });
  }
  return items;
}

async function checkMenuFidelity(siteJson) {
  if (!process.env.DATABASE_URL) return;
  let pg = null;
  try {
    pg = require("pg");
  } catch {
    try {
      pg = require("/opt/builder/node_modules/pg");
    } catch {
      return;
    }
  }
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
  });
  try {
    const row = await pool.query(
      "SELECT b.services FROM briefs b JOIN sites s ON s.id = b.site_id WHERE s.slug = $1",
      [siteJson.slug]
    );
    const briefServices = row.rows[0]?.services;
    if (!briefServices) return;
    if (/<\??(xml|urlset|script|loc|image)[\s>]/i.test(briefServices)) {
      add("warn", "menu-fidelity", "brief services look like pasted markup; skipped");
      return;
    }
    const items = parseBriefServices(briefServices);
    if (!items.length) return;
    const siteServices = Array.isArray(siteJson.services) ? siteJson.services : [];
    for (const sv of siteServices) {
      const name = String(sv.name || "").trim();
      if (!name) continue;
      const tokens = normTokens(name);
      if (!tokens.length) continue;
      let best = null;
      let bestScore = 0;
      for (const it of items) {
        const s = sharedWeight(tokens, normTokens(it.name));
        if (s > bestScore) {
          bestScore = s;
          best = it;
        }
      }
      if (!best || !namesMatch(name, best.name)) {
        add("error", "menu-fidelity", `service "${name}" is not in the owner's brief`);
        continue;
      }
      const sitePrice = String(sv.price || "").trim();
      const firstNum = (sitePrice.match(/\d[\d,]*/) || [])[0];
      const sitePriceN = firstNum ? parseInt(firstNum.replace(/,/g, ""), 10) : null;
      if (best.price !== null && sitePriceN !== null && sitePriceN !== best.price) {
        add("error", "menu-fidelity", `price mismatch for "${name}": site Rs. ${sitePriceN} vs brief Rs. ${best.price}`);
      } else if (best.price !== null && sitePrice && sitePriceN === null) {
        add("warn", "menu-fidelity", `"${name}" price "${sitePrice}" is not a number`);
      } else if (best.price === null && sitePriceN !== null) {
        add("warn", "menu-fidelity", `"${name}" has a price on the site but none in the brief`);
      }
    }
    if (items.length && siteServices.length) {
      const bad = siteServices.filter((sv) => {
        const t = normTokens(sv.name);
        if (!t.length) return false;
        return !items.some((it) => namesMatch(sv.name, it.name));
      });
      if (!bad.length) ok("menu-fidelity", `${siteServices.length} services match the brief`);
    }
  } catch (e) {
    add("warn", "menu-fidelity", "could not compare against the brief: " + e.message);
  } finally {
    await pool.end().catch(() => {});
  }
}

(async () => {
  if (site) {
    await checkMenuFidelity(site);
    const images = [
      ["hero_image", site.hero_image, 900, 400],
      ["about_image", site.about_image, 600, 350],
      ...(Array.isArray(site.gallery) ? site.gallery.map((u, i) => [`gallery[${i}]`, u, 400, 300]) : []),
    ];
    await Promise.all(images.filter(([, u]) => u).map(([l, u, w, h]) => checkImage(l, u, w, h)));
  }

  if (!noBrowser) {
    try {
      const browserCheck = require("./browser-check.cjs");
      report.browser = await browserCheck.run({ workspace, outDir, site });
      for (const c of report.browser.checks) {
        const tag = c.level === "error" ? "FAIL" : c.level === "warn" ? "WARN" : "ok  ";
        console.log(`[${tag}] browser:${c.check}: ${c.message}`);
        if (c.level === "error") report.counts.errors++;
        if (c.level === "warn") report.counts.warnings++;
      }
    } catch (e) {
      add("warn", "browser", "browser checks unavailable: " + e.message);
    }
  }

  report.finishedAt = new Date().toISOString();
  report.ok = report.counts.errors === 0;
  const reportPath = path.join(outDir, "report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n${report.ok ? "PASS" : "FAIL"} — ${report.counts.errors} error(s), ${report.counts.warnings} warning(s)`);
  console.log("report: " + reportPath);
  process.exit(report.ok ? 0 : 1);
})();

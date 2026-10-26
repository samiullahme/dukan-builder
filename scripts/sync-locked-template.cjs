#!/usr/bin/env node
/**
 * Safely syncs updated locked template files (store.js, forms.js, dashboard.js,
 * dashboard.html, contact.html, login.html) to existing tenant workspaces.
 *
 * Usage:
 *   node scripts/sync-locked-template.cjs --dry-run
 *   node scripts/sync-locked-template.cjs --pilot <slug>
 *   node scripts/sync-locked-template.cjs --all
 */
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function loadEnv() {
  const envPath = "/opt/builder/.env.opencode";
  const out = { ...process.env };
  if (fs.existsSync(envPath)) {
    const raw = fs.readFileSync(envPath, "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
  return out;
}

const env = loadEnv();
const TENANTS_ROOT = env.TENANTS_ROOT || "/opt/tenants";
const TEMPLATE_DIR = env.TEMPLATE_DIR || (fs.existsSync("/opt/builder/template") ? "/opt/builder/template" : path.join(__dirname, "../template"));
const PUBLISHED_ROOT = env.PUBLISHED_ROOT || "/opt/www/published";

const CHROME_PAGES = new Set(["about.html", "services.html", "gallery.html", "contact.html"]);

const SYNC_FILES = [
  "store.js",
  "forms.js",
  "dashboard.js",
  "auth.js",
  "admin-login.js",
  "admin.js",
  "site.js",
  "about.html",
  "services.html",
  "gallery.html",
  "contact.html",
  "login.html",
  "admin-login.html",
  "dashboard.html",
  "admin.html",
];

function extractChrome(indexPath) {
  if (!fs.existsSync(indexPath)) return null;
  const src = fs.readFileSync(indexPath, "utf8");
  const hStart = src.indexOf("<!-- chrome:header:start -->");
  const hEnd = src.indexOf("<!-- chrome:header:end -->");
  const fStart = src.indexOf("<!-- chrome:footer:start -->");
  const fEnd = src.indexOf("<!-- chrome:footer:end -->");

  let header = null;
  let footer = null;

  if (hStart >= 0 && hEnd > hStart) {
    header = src.slice(hStart + "<!-- chrome:header:start -->".length, hEnd).trim();
  }
  if (fStart >= 0 && fEnd > fStart) {
    footer = src.slice(fStart + "<!-- chrome:footer:start -->".length, fEnd).trim();
  }
  return { header, footer };
}

function setCurrentPage(block, page) {
  const bare = block.replace(/\saria-current="page"/gi, "");
  const clean = page.replace(/\.html$/i, "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return bare.replace(new RegExp(`(<a\\b[^>]*\\bhref="(?:\\/)?${clean}(?:\\.html)?"[^>]*)>`, "i"), '$1 aria-current="page">');
}

function injectChrome(pageHtml, chrome, pageName) {
  if (!chrome) return pageHtml;
  let res = pageHtml;
  if (chrome.header) {
    const s = res.indexOf("<!-- chrome:header:start -->");
    const e = res.indexOf("<!-- chrome:header:end -->");
    if (s >= 0 && e > s) {
      const scopedHeader = setCurrentPage(chrome.header.replace(/\bhref="#([^"\s]+)"/g, 'href="/#$1"'), pageName);
      res = res.slice(0, s + "<!-- chrome:header:start -->".length) + "\n" + scopedHeader + "\n" + res.slice(e);
    }
  }
  if (chrome.footer) {
    const s = res.indexOf("<!-- chrome:footer:start -->");
    const e = res.indexOf("<!-- chrome:footer:end -->");
    if (s >= 0 && e > s) {
      const scopedFooter = chrome.footer.replace(/\bhref="#([^"\s]+)"/g, 'href="/#$1"').replace(/\saria-current="page"/gi, "");
      res = res.slice(0, s + "<!-- chrome:footer:start -->".length) + "\n" + scopedFooter + "\n" + res.slice(e);
    }
  }
  return res;
}

function syncWorkspace(workspace, slug) {
  if (!fs.existsSync(workspace)) {
    return { ok: false, error: "Workspace directory does not exist: " + workspace };
  }

  const chrome = extractChrome(path.join(workspace, "index.html"));

  for (const file of SYNC_FILES) {
    const src = path.join(TEMPLATE_DIR, file);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(workspace, file);

    if (file.endsWith(".html")) {
      let content = fs.readFileSync(src, "utf8");
      content = content.split("__SITE_SLUG__").join(slug);
      if (CHROME_PAGES.has(file)) {
        content = injectChrome(content, chrome, file);
      }
      fs.writeFileSync(dest, content);
    } else {
      fs.copyFileSync(src, dest);
    }
  }

  // Also update published copy if present
  const publishedDir = path.join(PUBLISHED_ROOT, slug);
  if (fs.existsSync(publishedDir)) {
    for (const file of SYNC_FILES) {
      const wsFile = path.join(workspace, file);
      const pubFile = path.join(publishedDir, file);
      if (fs.existsSync(wsFile)) {
        fs.copyFileSync(wsFile, pubFile);
        try {
          fs.chmodSync(pubFile, 0o644);
        } catch (_) {}
      }
    }
  }

  return { ok: true };
}

async function main() {
  const args = process.argv.slice(2);
  const isAll = args.includes("--all");
  const pilotIdx = args.indexOf("--pilot");
  const pilotSlug = pilotIdx >= 0 ? args[pilotIdx + 1] : null;
  const isDryRun = args.includes("--dry-run") || (!isAll && !pilotSlug);

  if (!env.DATABASE_URL) {
    console.error("ERROR: DATABASE_URL not set.");
    process.exit(1);
  }

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });

  try {
    // 1. Guard check: No builds currently running
    const buildCheck = await pool.query("SELECT count(*)::int AS n FROM builds WHERE status = 'building'");
    const runningBuilds = buildCheck.rows[0].n;
    if (runningBuilds > 0) {
      console.error(`ABORT: ${runningBuilds} build(s) currently in progress. Exiting to avoid race conditions.`);
      process.exit(1);
    }

    // 2. Fetch sites
    const { rows: sites } = await pool.query(
      "SELECT id, user_id, slug, status FROM sites ORDER BY created_at ASC"
    );

    console.log(`Found ${sites.length} site(s) in database.`);
    console.log(`Template directory: ${TEMPLATE_DIR}`);
    console.log(`Tenants root: ${TENANTS_ROOT}`);
    console.log(`Mode: ${isDryRun ? "DRY-RUN" : pilotSlug ? `PILOT (${pilotSlug})` : "ALL SITES"}\n`);

    if (isDryRun) {
      console.log("=== DRY RUN REPORT ===");
      let existingCount = 0;
      for (const site of sites) {
        const ws = path.join(TENANTS_ROOT, site.user_id, site.slug);
        const exists = fs.existsSync(ws);
        if (exists) existingCount++;
        const pubExists = fs.existsSync(path.join(PUBLISHED_ROOT, site.slug));
        console.log(`Site: ${site.slug} | User: ${site.user_id} | Workspace: ${exists ? "EXISTS" : "MISSING"} | Published: ${pubExists ? "YES" : "NO"}`);
      }
      console.log(`\nDry run complete. ${existingCount}/${sites.length} workspace(s) exist on disk.`);
      console.log("To run on a single pilot: node scripts/sync-locked-template.cjs --pilot <slug>");
      console.log("To run on all sites:      node scripts/sync-locked-template.cjs --all");
      return;
    }

    const targetSites = pilotSlug ? sites.filter((s) => s.slug === pilotSlug) : sites;
    if (pilotSlug && targetSites.length === 0) {
      console.error(`ERROR: Pilot slug '${pilotSlug}' not found in database.`);
      process.exit(1);
    }

    console.log(`Syncing ${targetSites.length} site(s)...`);
    let successCount = 0;
    let skipCount = 0;

    for (const site of targetSites) {
      const ws = path.join(TENANTS_ROOT, site.user_id, site.slug);
      if (!fs.existsSync(ws)) {
        console.log(`SKIP ${site.slug}: workspace directory not found at ${ws}`);
        skipCount++;
        continue;
      }
      const res = syncWorkspace(ws, site.slug);
      if (res.ok) {
        console.log(`OK   ${site.slug}: synced ${SYNC_FILES.join(", ")}`);
        successCount++;
      } else {
        console.error(`FAIL ${site.slug}: ${res.error}`);
      }
    }

    console.log(`\nCompleted: ${successCount} synced, ${skipCount} skipped.`);
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});

#!/usr/bin/env node
"use strict";

/** Copy changed LOCKED template files into every existing workspace and
 *  published site, baking each site's slug back into the HTML files.
 *  Never touches the builder-editable files (site.json, index.html,
 *  styles.css) or the design/ folder. */

const fs = require("fs");
const path = require("path");

const TEMPLATE = process.env.TEMPLATE_DIR || "/opt/builder/template";
const TENANTS = process.env.TENANTS_ROOT || "/opt/tenants";
const PUBLISHED = "/opt/www/published";

const HTML_FILES = ["login.html", "admin-login.html", "admin.html", "dashboard.html"];
const PLAIN_FILES = [
  "admin-login.js",
  "admin.js",
  "auth.js",
  "site.js",
  "store.js",
  "forms.js",
  "dashboard.js",
  "AGENTS.md",
];

function syncOne(dir, slug) {
  for (const f of HTML_FILES) {
    const src = path.join(TEMPLATE, f);
    if (!fs.existsSync(src)) continue;
    const html = fs.readFileSync(src, "utf8").split("__SITE_SLUG__").join(slug);
    fs.writeFileSync(path.join(dir, f), html);
  }
  for (const f of PLAIN_FILES) {
    const src = path.join(TEMPLATE, f);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(dir, f));
  }
}

const targets = [];
if (fs.existsSync(TENANTS)) {
  for (const user of fs.readdirSync(TENANTS)) {
    const ud = path.join(TENANTS, user);
    let st;
    try {
      st = fs.statSync(ud);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    for (const slug of fs.readdirSync(ud)) {
      const d = path.join(ud, slug);
      if (fs.existsSync(path.join(d, "site.json"))) targets.push([d, slug]);
    }
  }
}
if (fs.existsSync(PUBLISHED)) {
  for (const slug of fs.readdirSync(PUBLISHED)) {
    const d = path.join(PUBLISHED, slug);
    if (fs.existsSync(path.join(d, "site.json"))) targets.push([d, slug]);
  }
}

let failed = 0;
for (const [dir, slug] of targets) {
  try {
    syncOne(dir, slug);
    console.log("synced " + dir);
  } catch (e) {
    failed++;
    console.error("FAILED " + dir + ": " + e.message);
  }
}
console.log(`done: ${targets.length} target(s), ${failed} failed`);
process.exit(failed ? 1 : 0);

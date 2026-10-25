#!/usr/bin/env node
// One-shot migration: SQLite (better-sqlite3) -> Supabase Postgres + Supabase Auth.
//
// Run ON THE SERVER inside /opt/builder, with the old SQLite db present at data/builder.db.
// Needs node_modules containing better-sqlite3, pg and @supabase/supabase-js.
//
//   node scripts/migrate-to-supabase.mjs            # real import
//   node scripts/migrate-to-supabase.mjs --dry-run  # report only, no writes, no API calls
//   node scripts/migrate-to-supabase.mjs --no-schema  # skip applying supabase/migrations/001_init.sql
//   node scripts/migrate-to-supabase.mjs --db /path/to/builder.db
//
// Secrets come from the environment (DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
// or from /opt/builder/.env.opencode (KEY=VALUE lines). Never passed on the command line,
// never printed. Temp passwords are written to /opt/builder/.migration/temp-passwords.txt
// (mode 600) so the owner can hand them out; they are never echoed.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import Database from "better-sqlite3";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_DIR = path.join(root, ".migration");

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const SKIP_SCHEMA = args.includes("--no-schema");
const dbFlag = args.indexOf("--db");
const SQLITE_PATH = dbFlag !== -1 ? args[dbFlag + 1] : path.join(root, "data", "builder.db");
const SCHEMA_FILE = path.join(root, "supabase", "migrations", "001_init.sql");

function fail(msg) {
  console.error(`[migrate] ERROR: ${msg}`);
  process.exit(1);
}

// ---- secrets ---------------------------------------------------------------

function readEnvFile(p) {
  if (!fs.existsSync(p)) return {};
  const out = {};
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const envFile = readEnvFile(path.join(root, ".env.opencode"));
const DATABASE_URL = process.env.DATABASE_URL ?? envFile.DATABASE_URL;
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? envFile.SUPABASE_URL ?? envFile.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? envFile.SUPABASE_SERVICE_ROLE_KEY;

if (!DRY_RUN) {
  if (!DATABASE_URL) fail("DATABASE_URL not set (env or .env.opencode).");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)
    fail("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set (env or .env.opencode).");
}

// ---- helpers ---------------------------------------------------------------

const toIso = (s) => (s ? String(s).replace(" ", "T") + "Z" : null);
const now = () => new Date().toISOString();

// Port of lib/failures.ts so legacy logs get a failure_reason during import.
function classifyFailure(msg) {
  const m = String(msg).toLowerCase();
  if (m.includes("quota exhausted")) return "quota_exhausted";
  if (m.includes("interrupted by a server restart")) return "interrupted";
  if (m.includes("timed out")) return "agent_timeout";
  if (m.includes("qa failed") || m.includes("qa report")) return "qa_failed";
  if (m.includes("agent reported an error") || m.includes("unexpected token")) return "agent_error";
  if (m.includes("sanity check failed")) return "sanity_check";
  if (
    m.includes("opencode serve") ||
    m.includes("workspace missing") ||
    m.includes("site row disappeared") ||
    m.includes("could not write opencode")
  ) {
    return "infra_error";
  }
  return "unknown";
}
function failureReasonFromLog(log) {
  const lines = String(log).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const idx = lines[i].indexOf("FAILED:");
    if (idx !== -1) return classifyFailure(lines[i].slice(idx + 7));
  }
  return "unknown";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const genTempPassword = () => {
  const raw = crypto.randomBytes(9).toString("base64url");
  return `Db${raw}A1`; // 15 chars, upper+lower+digit
};

// ---- read sqlite -----------------------------------------------------------

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const users = sqlite.prepare("SELECT id, email, is_admin, created_at FROM users ORDER BY created_at").all();
const quota = sqlite.prepare("SELECT user_id, builds_used, builds_allowed FROM quota").all();
const sites = sqlite
  .prepare("SELECT id, user_id, slug, business_name, status, category, created_at FROM sites ORDER BY created_at")
  .all();
const briefs = sqlite
  .prepare(
    "SELECT id, site_id, instructions, address, phone, hours, services, colors, category, design_plan, design_image, design_image_mime, design_notes, media, created_at FROM briefs"
  )
  .all();
const builds = sqlite
  .prepare(
    "SELECT id, site_id, opencode_session_id, status, kind, input, log, started_at, finished_at, created_at FROM builds ORDER BY created_at"
  )
  .all();
const chats = sqlite.prepare("SELECT id, site_id, role, content, created_at FROM chat_messages").all();
const rateLimits = sqlite.prepare("SELECT key, tokens, updated_at FROM rate_limits").all();
const previewCount = sqlite.prepare("SELECT count(*) n FROM previews").get().n;
const sessionCount = sqlite.prepare("SELECT count(*) n FROM sessions").get().n;

const legacyUserIds = new Set(users.map((u) => u.id));
const orphanQuota = quota.filter((q) => !legacyUserIds.has(q.user_id));
const orphanSites = sites.filter((s) => !legacyUserIds.has(s.user_id));
const skippedKeys = rateLimits.filter((r) => UUID_RE.test(r.key.slice(r.key.lastIndexOf(":") + 1)));
const keptKeys = rateLimits.filter((r) => !UUID_RE.test(r.key.slice(r.key.lastIndexOf(":") + 1)));

// Builds stuck in flight when the old app was stopped: import them as failed.
const convertedBuilds = [];
const finalBuilds = builds.map((b) => {
  if (b.status === "queued" || b.status === "building") {
    convertedBuilds.push(b.id);
    return {
      ...b,
      status: "failed",
      failure_reason: "interrupted",
      finished_at: b.finished_at ?? b.started_at ?? b.created_at,
      log: `${b.log}\n[migration ${now()}] Build was queued or running when the database was migrated; marked failed.`,
    };
  }
  return {
    ...b,
    failure_reason: b.status === "failed" ? failureReasonFromLog(b.log) : null,
  };
});

// ---- dry-run report --------------------------------------------------------

const report = {
  users: users.length,
  admins: users.filter((u) => u.is_admin).length,
  quota: quota.length - orphanQuota.length,
  quotaOrphans: orphanQuota.map((q) => q.user_id),
  sites: sites.length - orphanSites.length,
  siteOrphans: orphanSites.map((s) => s.id),
  briefs: briefs.length,
  builds: builds.length,
  buildConverted: convertedBuilds.length,
  failureReasons: {},
  chats: chats.length,
  rateLimits: keptKeys.length,
  rateLimitSkipped: skippedKeys.length,
  previewsSkipped: previewCount,
  sessionsSkipped: sessionCount,
};
for (const b of finalBuilds) {
  if (b.status !== "failed") continue;
  report.failureReasons[b.failure_reason] = (report.failureReasons[b.failure_reason] ?? 0) + 1;
}

console.log(`[migrate] SQLite: ${SQLITE_PATH}`);
console.log(`[migrate] mode: ${DRY_RUN ? "DRY-RUN (no writes)" : "IMPORT"}`);
console.log(`[migrate] users: ${report.users} (${report.admins} admins)`);
console.log(`[migrate] quota: ${report.quota} rows${orphanQuota.length ? `, skipping ${orphanQuota.length} orphan(s): ${orphanQuota.map((q) => q.user_id).join(", ")}` : ""}`);
console.log(`[migrate] sites: ${report.sites}${orphanSites.length ? `, skipping ${orphanSites.length} orphan(s): ${orphanSites.map((s) => s.id).join(", ")}` : ""}`);
console.log(`[migrate] briefs: ${report.briefs}, chat messages: ${report.chats}`);
console.log(`[migrate] builds: ${report.builds} (${convertedBuilds.length} queued/building -> failed/interrupted)`);
if (Object.keys(report.failureReasons).length) {
  console.log(`[migrate] failure_reason backfill: ${JSON.stringify(report.failureReasons)}`);
}
console.log(`[migrate] rate_limits: ${report.rateLimits} imported, ${report.rateLimitSkipped} user-keyed rows skipped`);
console.log(`[migrate] skipped tables: sessions (${report.sessionsSkipped} rows, old auth), previews (${report.previewsSkipped} rows, stale processes)`);

if (DRY_RUN) {
  console.log("[migrate] DRY-RUN complete. Nothing was written.");
  process.exit(0);
}

// ---- connect to postgres + supabase -----------------------------------------

const pgClient = new pg.Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
await pgClient.connect();

if (!SKIP_SCHEMA) {
  if (!fs.existsSync(SCHEMA_FILE)) fail(`schema file not found: ${SCHEMA_FILE}`);
  const schemaSql = fs.readFileSync(SCHEMA_FILE, "utf8");
  await pgClient.query(schemaSql);
  console.log("[migrate] schema applied (supabase/migrations/001_init.sql)");
}

// Note: profiles may already have rows created by the handle_new_user() trigger
// when auth users were created — that is expected and the upserts below fix the
// is_admin/status/created_at values. sites, however, is written ONLY by this
// import, so it is the true marker of a previously committed run.
const empty = await pgClient.query("SELECT 1 FROM public.sites LIMIT 1");
if (empty.rowCount > 0) {
  await pgClient.end();
  fail(
    "public.sites already has rows. Refusing to import on top of existing data. " +
      "If a previous run failed after its transaction committed, this is expected - do not re-run."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Map old sqlite user id -> new Supabase Auth uuid. Reuse existing auth users
// with the same email so a retry after a partial failure does not duplicate.
const idMap = new Map();
const tempPasswords = [];
{
  const { data: existingUsers, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) {
    await pgClient.end();
    fail(`could not list Supabase auth users: ${listErr.message}`);
  }
  const byEmail = new Map(
    (existingUsers.users ?? []).map((u) => [String(u.email ?? "").toLowerCase(), u.id])
  );

  for (const u of users) {
    const email = String(u.email).toLowerCase();
    let newId = byEmail.get(email);
    if (!newId) {
      const password = genTempPassword();
      const { data: created, error: createErr } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createErr || !created?.user) {
        await pgClient.end();
        fail(`could not create Supabase auth user for ${email}: ${createErr?.message ?? "no user returned"}`);
      }
      newId = created.user.id;
      tempPasswords.push({ email, password });
    }
    idMap.set(u.id, newId);
  }
  console.log(
    `[migrate] auth users: created ${tempPasswords.length}, reused ${users.length - tempPasswords.length}`
  );
}

// ---- insert into postgres (single transaction) ------------------------------

const INSERT_PROFILE = `
  INSERT INTO public.profiles (id, email, is_admin, status, created_at)
  VALUES ($1,$2,$3,$4,$5)
  ON CONFLICT (id) DO UPDATE SET
    email = excluded.email,
    is_admin = excluded.is_admin,
    status = excluded.status,
    created_at = excluded.created_at
`;
const INSERT_QUOTA = `
  INSERT INTO public.quota (user_id, builds_used, builds_allowed)
  VALUES ($1,$2,$3)
  ON CONFLICT (user_id) DO UPDATE SET
    builds_used = excluded.builds_used,
    builds_allowed = excluded.builds_allowed
`;
const INSERT_SITE = `
  INSERT INTO public.sites (id, user_id, slug, business_name, status, category, created_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7)
`;
const INSERT_BRIEF = `
  INSERT INTO public.briefs (id, site_id, instructions, address, phone, hours, services, colors, category,
    design_plan, design_image, design_image_mime, design_notes, media, created_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
`;
const INSERT_BUILD = `
  INSERT INTO public.builds (id, site_id, opencode_session_id, status, kind, input, failure_reason,
    reviewed, log, started_at, finished_at, created_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11)
`;
const INSERT_CHAT = `
  INSERT INTO public.chat_messages (id, site_id, role, content, created_at)
  VALUES ($1,$2,$3,$4,$5)
`;
const INSERT_RATE_LIMIT = `
  INSERT INTO public.rate_limits (key, tokens, updated_at)
  VALUES ($1,$2,$3)
`;

try {
  await pgClient.query("BEGIN");
  for (const u of users) {
    await pgClient.query(INSERT_PROFILE, [idMap.get(u.id), String(u.email).toLowerCase(), u.is_admin ? 1 : 0, "active", toIso(u.created_at)]);
  }
  for (const q of quota) {
    const newId = idMap.get(q.user_id);
    if (!newId) continue;
    await pgClient.query(INSERT_QUOTA, [newId, q.builds_used, q.builds_allowed]);
  }
  for (const s of sites) {
    const newId = idMap.get(s.user_id);
    if (!newId) continue;
    await pgClient.query(INSERT_SITE, [s.id, newId, s.slug, s.business_name, s.status, s.category, toIso(s.created_at)]);
  }
  for (const b of briefs) {
    await pgClient.query(INSERT_BRIEF, [
      b.id, b.site_id, b.instructions, b.address, b.phone, b.hours, b.services, b.colors, b.category,
      b.design_plan, b.design_image, b.design_image_mime, b.design_notes, b.media, toIso(b.created_at),
    ]);
  }
  for (const b of finalBuilds) {
    await pgClient.query(INSERT_BUILD, [
      b.id, b.site_id, b.opencode_session_id, b.status, b.kind, b.input, b.failure_reason,
      b.log, toIso(b.started_at), toIso(b.finished_at), toIso(b.created_at),
    ]);
  }
  for (const c of chats) {
    await pgClient.query(INSERT_CHAT, [c.id, c.site_id, c.role, c.content, toIso(c.created_at)]);
  }
  for (const r of keptKeys) {
    await pgClient.query(INSERT_RATE_LIMIT, [r.key, r.tokens, Math.round(Number(r.updated_at))]);
  }
  await pgClient.query("COMMIT");
  console.log("[migrate] postgres transaction committed");
} catch (e) {
  await pgClient.query("ROLLBACK");
  await pgClient.end();
  fail(`postgres transaction rolled back: ${e.message}`);
}
await pgClient.end();

// ---- temp passwords ---------------------------------------------------------

if (tempPasswords.length) {
  fs.mkdirSync(MIGRATION_DIR, { recursive: true, mode: 0o700 });
  const pwFile = path.join(MIGRATION_DIR, "temp-passwords.txt");
  const lines = tempPasswords
    .map((t) => `${t.email}\t${t.password}\t(change after first login)`)
    .join("\n");
  fs.writeFileSync(pwFile, `Generated ${now()} by scripts/migrate-to-supabase.mjs\n` + lines + "\n", { mode: 0o600 });
  console.log(`[migrate] temp passwords for ${tempPasswords.length} new auth users: ${pwFile} (chmod 600)`);
}

console.log("[migrate] IMPORT COMPLETE");
console.log("[migrate] next steps:");
console.log("  - keep data/builder.db as the legacy backup (read-only)");
console.log("  - log in with your email + the temp password from .migration/temp-passwords.txt");
console.log("  - change passwords (Admin > Users > your profile > Reset password), then delete the temp-password file");
console.log("  - remove argon2 and better-sqlite3 from package.json once the site is verified on Supabase");

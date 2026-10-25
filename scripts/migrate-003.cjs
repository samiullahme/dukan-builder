// One-off runner: applies migration 003 — dedicated tables for site request
// data so customer submissions reach the owner dashboard across browsers.
//   site_requests     bookings + enquiries submitted through the public forms
//   site_subscribers  newsletter sign-ups
// Run on the server as builder: sudo -u builder bash -c 'cd /opt/builder && node scripts/migrate-003.cjs'
const fs = require("fs");
const { Pool } = require("pg");

function env() {
  const raw = fs.readFileSync("/opt/builder/.env.opencode", "utf8");
  const out = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

(async () => {
  const e = env();
  const pool = new Pool({ connectionString: e.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  await pool.query(`create table if not exists public.site_requests (
    id text primary key,
    site_id text not null references public.sites(id) on delete cascade,
    ref text not null,
    type text not null check (type in ('booking','inquiry')),
    status text not null default 'new',
    name text not null default '',
    email text not null default '',
    phone text not null default '',
    message text not null default '',
    fields jsonb not null default '{}'::jsonb,
    sample boolean not null default false,
    created_at timestamptz not null default now()
  )`);
  await pool.query(`create unique index if not exists site_requests_site_ref_uq
    on public.site_requests (site_id, ref)`);
  await pool.query(`create index if not exists site_requests_site_created_idx
    on public.site_requests (site_id, created_at desc)`);

  await pool.query(`create table if not exists public.site_subscribers (
    id text primary key,
    site_id text not null references public.sites(id) on delete cascade,
    email text not null,
    name text not null default '',
    sample boolean not null default false,
    created_at timestamptz not null default now()
  )`);
  await pool.query(`create unique index if not exists site_subscribers_site_email_uq
    on public.site_subscribers (site_id, email)`);

  await pool.query(`alter table public.sites
    add column if not exists data_seeded boolean not null default false`);

  console.log("migration 003 DDL applied");

  const req = await pool.query("SELECT count(*)::int AS c FROM site_requests");
  const subs = await pool.query("SELECT count(*)::int AS c FROM site_subscribers");
  console.log(`site_requests has ${req.rows[0].c} row(s), site_subscribers has ${subs.rows[0].c} row(s)`);
  await pool.end();
})().catch((e) => {
  console.error("migrate-003 failed:", e.message);
  process.exit(1);
});

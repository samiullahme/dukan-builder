// One-off runner: applies migration 002 (site_admins + profiles TOTP columns)
// and backfills an encrypted credential for every existing site.
// Run on the server as builder: sudo -u builder bash -c 'cd /opt/builder && node scripts/migrate-002.cjs'
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");

const PW_LOWER = "abcdefghjkmnpqrstuvwxyz";
const PW_UPPER = "ABCDEFGHJKMNPQRSTUVWXYZ";
const PW_DIGITS = "23456789";
const PW_ALPHABET = PW_LOWER + PW_UPPER + PW_DIGITS;

function env() {
  const raw = fs.readFileSync("/opt/builder/.env.opencode", "utf8");
  const out = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function generatePassword(len = 14) {
  const bytes = crypto.randomBytes(len);
  const s = Array.from({ length: len }, (_, i) => PW_ALPHABET[bytes[i] % PW_ALPHABET.length]).join("");
  return (
    PW_LOWER[bytes[0] % PW_LOWER.length] +
    PW_UPPER[bytes[1] % PW_UPPER.length] +
    PW_DIGITS[bytes[2] % PW_DIGITS.length] +
    s.slice(3)
  );
}

function encrypt(plain, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}.${tag.toString("hex")}.${ct.toString("hex")}`;
}

(async () => {
  const e = env();
  const pool = new Pool({ connectionString: e.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  const keyHex = (e.SITE_ADMIN_ENC_KEY || "").replace(/[^0-9a-fA-F]/g, "");
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) throw new Error("SITE_ADMIN_ENC_KEY missing or not 32 bytes of hex in .env.opencode");

  await pool.query(`create table if not exists public.site_admins (
    id text primary key,
    site_id text not null unique references public.sites(id) on delete cascade,
    username text not null unique,
    password_enc text not null,
    created_at timestamptz not null default now()
  )`);
  await pool.query(`alter table public.profiles
    add column if not exists totp_secret text,
    add column if not exists totp_enabled boolean not null default false,
    add column if not exists credentials_unlocked_until timestamptz`);
  console.log("migration 002 DDL applied");

  const sites = await pool.query(
    `SELECT s.id, s.slug FROM sites s WHERE NOT EXISTS (SELECT 1 FROM site_admins sa WHERE sa.site_id = s.id)`
  );
  for (const s of sites.rows) {
    const password = generatePassword();
    const enc = encrypt(password, key);
    await pool.query(
      `INSERT INTO site_admins (id, site_id, username, password_enc) VALUES ($1,$2,$3,$4) ON CONFLICT (site_id) DO NOTHING`,
      [crypto.randomUUID(), s.id, s.slug, enc]
    );
  }
  console.log(`backfilled ${sites.rows.length} site credential(s)`);

  const total = await pool.query("SELECT count(*)::int AS c FROM site_admins");
  console.log(`site_admins now has ${total.rows[0].c} row(s)`);
  await pool.end();
})().catch((e) => {
  console.error("migrate-002 failed:", e.message);
  process.exit(1);
});

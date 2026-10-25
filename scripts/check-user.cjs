// Read-only: show a user's sites + rate limits + recent builder log noise.
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
  const p = new Pool({ connectionString: e.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  const users = await p.query(
    "SELECT id, email, created_at FROM auth.users ORDER BY created_at DESC LIMIT 20"
  );
  for (const u of users.rows) {
    console.log(`user ${u.email} created ${u.created_at.toISOString()} id=${u.id}`);
  }
  const recent = await p.query(
    "SELECT slug, business_name, status, created_at FROM sites ORDER BY created_at DESC LIMIT 8"
  );
  console.log("latest sites:", JSON.stringify(recent.rows));
  await p.end();
})().catch((err) => { console.error("ERR", err.message); process.exit(1); });

// Reports queued/building builds. Exits 1 if any are active (do not restart the app).
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
  const rows = await pool.query(
    "SELECT id, site_id, status, kind FROM builds WHERE status IN ('queued','building')"
  );
  await pool.end();
  if (rows.rows.length) {
    console.log("ACTIVE BUILDS: " + JSON.stringify(rows.rows));
    process.exit(1);
  }
  console.log("no active builds");
})().catch((e) => {
  console.error("check-builds failed:", e.message);
  process.exit(2);
});

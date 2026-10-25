const fs = require("fs");
const { Client } = require("pg");
const env = Object.fromEntries(
  fs.readFileSync("/opt/builder/.env.opencode", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);
const c = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await c.connect();
  const r = await c.query("SELECT id, site_id, status, kind, created_at FROM builds WHERE status IN ('queued','building') ORDER BY created_at");
  console.log(JSON.stringify(r.rows));
  await c.end();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});

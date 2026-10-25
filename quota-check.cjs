const fs = require("fs");
const { Client } = require("pg");
const env = Object.fromEntries(
  fs.readFileSync("/opt/builder/.env.opencode", "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const c = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await c.connect();
  const r = await c.query(`SELECT p.email, q.builds_used, q.builds_allowed FROM profiles p LEFT JOIN quota q ON q.user_id = p.id WHERE p.email LIKE 'qa.%' OR p.email LIKE 'designqa%'`);
  console.log(JSON.stringify(r.rows));
  await c.end();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });

// Delete one test user + all its rows + workspace. For my own diagnostic accounts only.
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
  const email = process.argv[2];
  if (!email) { console.error("usage: node cleanup-test-user.cjs <email>"); process.exit(1); }
  const e = env();
  const p = new Pool({ connectionString: e.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  const u = await p.query("SELECT id FROM auth.users WHERE email = $1", [email]);
  if (!u.rows[0]) { console.log("no user with email", email); process.exit(0); }
  const userId = u.rows[0].id;

  const sites = await p.query(
    "SELECT s.id, s.slug, b.design_image FROM sites s LEFT JOIN briefs b ON b.site_id = s.id WHERE s.user_id = $1",
    [userId]
  );
  console.log("sites:", sites.rows.map((s) => s.slug).join(", ") || "(none)");

  for (const s of sites.rows) {
    await p.query("DELETE FROM briefs WHERE site_id = $1", [s.id]);
    await p.query("DELETE FROM chat_messages WHERE site_id = $1", [s.id]);
    await p.query("DELETE FROM builds WHERE site_id = $1", [s.id]);
    if (s.design_image && fs.existsSync(s.design_image)) {
      fs.rmSync(s.design_image, { force: true });
      console.log("removed upload", s.design_image);
    }
  }
  await p.query("DELETE FROM sites WHERE user_id = $1", [userId]);
  await p.query("DELETE FROM rate_limits WHERE key LIKE $1", [`%${userId}%`]);
  await p.query("DELETE FROM quota WHERE user_id = $1", [userId]);
  await p.query("DELETE FROM profiles WHERE id = $1", [userId]);
  await p.query("DELETE FROM auth.users WHERE id = $1", [userId]);
  await p.query("DELETE FROM audit_log WHERE actor_id = $1", [userId]);

  const ws = `/opt/tenants/${userId}`;
  if (fs.existsSync(ws)) {
    fs.rmSync(ws, { recursive: true, force: true });
    console.log("removed workspace", ws);
  }
  await p.end();
  console.log("done:", email, userId);
})().catch((err) => { console.error("ERR", err.message); process.exit(1); });

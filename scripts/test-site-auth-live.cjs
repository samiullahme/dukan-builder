// Live check of the generated-site owner login (/_api/site-auth) behind Caddy.
// Prints OK/FAIL lines only — never echoes credentials or tokens.
const fs = require("fs");
const crypto = require("crypto");
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

let failed = 0;
function check(name, cond, extra) {
  if (!cond) failed++;
  console.log(`${cond ? "OK  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
}

(async () => {
  const e = env();
  const slug = process.argv[2] || "lahore-food-street-bbq-2";
  const domain = process.env.BASE_DOMAIN || "lanesite.pro";
  const BASE = `https://${slug}.${domain}`;
  const encKey = Buffer.from((e.SITE_ADMIN_ENC_KEY || "").replace(/[^0-9a-fA-F]/g, ""), "hex");
  check("enc-key", encKey.length === 32);

  const pool = new Pool({
    connectionString: e.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 2,
  });
  const { rows } = await pool.query(
    "SELECT sa.username, sa.password_enc, sa.site_id FROM site_admins sa JOIN sites s ON s.id = sa.site_id WHERE s.slug = $1",
    [slug]
  );
  await pool.end().catch(() => {});
  check("db-credential", rows.length === 1, rows.length ? "found" : "missing");
  if (!rows.length) process.exit(1);

  const [ivh, tagh, cth] = rows[0].password_enc.split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", encKey, Buffer.from(ivh, "hex"));
  d.setAuthTag(Buffer.from(tagh, "hex"));
  const password = Buffer.concat([d.update(Buffer.from(cth, "hex")), d.final()]).toString("utf8");
  const username = rows[0].username;

  const login = async (u, p) => {
    const res = await fetch(`${BASE}/_api/site-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, username: u, password: p }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const good = await login(username, password);
  check("login-ok", good.status === 200 && !!good.body.token, `http ${good.status}`);

  const bad = await login(username, "wrong-password-123");
  check("login-reject", bad.status === 401, `http ${bad.status}`);

  if (good.body.token) {
    const v = await fetch(`${BASE}/_api/site-auth/verify?token=${encodeURIComponent(good.body.token)}`);
    const vb = await v.json().catch(() => ({}));
    check("verify-ok", v.status === 200 && vb.valid === true && vb.site_id === rows[0].site_id && vb.username === username);
    const badV = await fetch(`${BASE}/_api/site-auth/verify?token=v1.zzzz.yyyy`);
    check("verify-reject", badV.status === 401, `http ${badV.status}`);
  }

  const adminJs = await (await fetch(`${BASE}/admin.js`)).text();
  check("admin-login-referenced", /admin-login\.html/.test(adminJs), "admin.js redirects to the owner sign-in page");
  const loginHtml = await (await fetch(`${BASE}/login.html`)).text();
  check("demo-box-gone", !/demo-box|owner@site\.local|owner123/i.test(loginHtml), "no demo accounts on login.html");

  console.log(failed ? "RESULT: FAIL" : "RESULT: ALL OK");
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.log("FAIL uncaught — " + err.message);
  process.exit(1);
});

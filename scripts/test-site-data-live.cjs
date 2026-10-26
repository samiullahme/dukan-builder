// Live check of the site-data layer (/_api/site-data*) behind Caddy:
// public submission, owner list/status/delete, cancel and cleanup.
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

const post = async (path, body) => {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

(async () => {
  const e = env();
  const slug = process.argv[2] || "lahore-food-street-bbq-2";
  const domain = process.env.BASE_DOMAIN || "lanesite.pro";
  const BASE = `https://${slug}.${domain}`;
  const stamp = Date.now().toString(36);
  const email = `qa-live-${stamp}@example.com`;
  const subEmail = `qa-live-sub-${stamp}@example.com`;
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
  if (!rows.length) {
    console.log("FAIL db-credential — missing");
    await pool.end().catch(() => {});
    process.exit(1);
  }
  const siteId = rows[0].site_id;
  const [ivh, tagh, cth] = rows[0].password_enc.split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", encKey, Buffer.from(ivh, "hex"));
  d.setAuthTag(Buffer.from(tagh, "hex"));
  const password = Buffer.concat([d.update(Buffer.from(cth, "hex")), d.final()]).toString("utf8");
  check("db-credential", true, "found");

  const login = await post(`${BASE}/_api/site-auth`, { slug, username: rows[0].username, password });
  check("owner-login", login.status === 200 && !!login.body.token, `http ${login.status}`);
  const token = login.body.token || "";
  const authHeaders = { "Content-Type": "application/json" };

  // Public submission (booking).
  const sub = await post(`${BASE}/_api/site-data/request`, {
    slug,
    type: "booking",
    name: "Live Test",
    email,
    phone: "03001234567",
    message: "Automated live verification.",
    fields: { date: "2030-01-01", time: "10:00", guests: "2" },
  });
  check("submit-ok", sub.status === 200 && sub.body.ok === true && /^BK-/.test(sub.body.request?.ref || ""), `http ${sub.status}`);
  const ref = sub.body.request?.ref || "";

  // Public newsletter subscription.
  const subNews = await post(`${BASE}/_api/site-data/subscriber`, { slug, email: subEmail, name: "Live Test" });
  check("subscribe-ok", subNews.status === 200 && subNews.body.ok === true, `http ${subNews.status}`);
  const dupNews = await post(`${BASE}/_api/site-data/subscriber`, { slug, email: subEmail, name: "Live Test" });
  check("subscribe-dupe-rejected", dupNews.status === 409, `http ${dupNews.status}`);

  // Owner list sees both.
  const list = async () => {
    const res = await fetch(`${BASE}/_api/site-data?token=${encodeURIComponent(token)}`);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const first = await list();
  check("owner-list", first.status === 200 && Array.isArray(first.body.requests), `http ${first.status}`);
  check("owner-sees-request", !!first.body.requests?.some((r) => r.ref === ref && r.email === email));
  check("owner-sees-subscriber", !!first.body.subscribers?.some((s) => s.email === subEmail));

  // Owner status change persists.
  const reqId = first.body.requests?.find((r) => r.ref === ref)?.id || "";
  const patch = async (id, status) => {
    const res = await fetch(`${BASE}/_api/site-data`, {
      method: "PATCH",
      headers: authHeaders,
      body: JSON.stringify({ token, id, status }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const patched = await patch(reqId, "confirmed");
  check("status-patch", patched.status === 200 && patched.body.ok === true, `http ${patched.status}`);
  const afterPatch = await list();
  check("status-persists", !!afterPatch.body.requests?.some((r) => r.ref === ref && r.status === "confirmed"));

  // Public lookup by ref + email.
  const lookup = await post(`${BASE}/_api/site-data/lookup`, { slug, email, refs: [ref] });
  check("lookup-ok", lookup.status === 200 && Array.isArray(lookup.body.requests) && lookup.body.requests.length === 1 && lookup.body.requests[0].ref === ref && lookup.body.requests[0].status === "confirmed", `http ${lookup.status}`);
  check("lookup-whitelist-safe", lookup.body.requests[0]?.name === undefined && lookup.body.requests[0]?.phone === undefined && lookup.body.requests[0]?.message === undefined);

  // Reject lookup with wrong email.
  const badLookup = await post(`${BASE}/_api/site-data/lookup`, { slug, email: "nobody@example.com", refs: [ref] });
  check("lookup-email-guard", badLookup.status === 200 && Array.isArray(badLookup.body.requests) && badLookup.body.requests.length === 0, `http ${badLookup.status}`);

  // Public cancel by ref + email.
  const cancel = await post(`${BASE}/_api/site-data/cancel`, { slug, ref, email });
  check("cancel-ok", cancel.status === 200 && cancel.body.ok === true, `http ${cancel.status}`);
  const afterCancel = await list();
  check("cancel-persists", !!afterCancel.body.requests?.some((r) => r.ref === ref && r.status === "cancelled"));

  // Reject a cancel that uses the wrong email.
  const badCancel = await post(`${BASE}/_api/site-data/cancel`, { slug, ref, email: "nobody@example.com" });
  check("cancel-email-guard", badCancel.status === 404, `http ${badCancel.status}`);

  // Owner delete both rows; the list must no longer contain them.
  const delReq = await fetch(`${BASE}/_api/site-data`, {
    method: "DELETE",
    headers: authHeaders,
    body: JSON.stringify({ token, id: reqId }),
  });
  check("request-delete", delReq.status === 200, `http ${delReq.status}`);
  const subId = first.body.subscribers?.find((s) => s.email === subEmail)?.id || "";
  const delSub = await fetch(`${BASE}/_api/site-data/subscriber`, {
    method: "DELETE",
    headers: authHeaders,
    body: JSON.stringify({ token, id: subId }),
  });
  check("subscriber-delete", delSub.status === 200, `http ${delSub.status}`);
  const afterDelete = await list();
  check("rows-gone", !afterDelete.body.requests?.some((r) => r.ref === ref) && !afterDelete.body.subscribers?.some((s) => s.email === subEmail));

  // DB rows are really gone.
  const dbCheck = await pool.query(
    "SELECT (SELECT count(*)::int FROM site_requests WHERE site_id = $1 AND email = $2) AS req, (SELECT count(*)::int FROM site_subscribers WHERE site_id = $1 AND email = $3) AS sub",
    [siteId, email, subEmail]
  );
  await pool.end().catch(() => {});
  check("db-clean", dbCheck.rows[0].req === 0 && dbCheck.rows[0].sub === 0, "no leftover rows");

  console.log(failed ? "RESULT: FAIL" : "RESULT: ALL OK");
  process.exit(failed ? 1 : 0);
})().catch((err) => {
  console.log("FAIL uncaught — " + err.message);
  process.exit(1);
});

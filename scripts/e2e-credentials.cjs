// End-to-end check of owner credentials + TOTP against the live app (127.0.0.1:3010).
// Creates a throwaway test user + site. Afterwards: node scripts/cleanup-test-user.cjs <userId> <email>
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

// TOTP — same algorithm as lib/site-admin.ts
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(s) {
  const clean = s.toUpperCase().replace(/=+$/, "").replace(/[\s-]/g, "");
  const out = [];
  let bits = 0,
    acc = 0;
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error("bad base32");
    acc = ((acc << 5) | v) & 0xffffffff;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 0xff);
    }
  }
  return Buffer.from(out);
}
function totpAt(secret, seconds) {
  const counter = Math.floor(seconds / 30);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | ((h[o + 1] & 0xff) << 16) | ((h[o + 2] & 0xff) << 8) | (h[o + 3] & 0xff);
  return String(bin % 1e6).padStart(6, "0");
}

(async () => {
  const e = env();
  const APP = "http://127.0.0.1:3010";
  const SUPABASE = e.NEXT_PUBLIC_SUPABASE_URL;
  const ANON = e.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const REF = new URL(SUPABASE).hostname.split(".")[0];
  const email = `e2e-creds-${Date.now()}@dukanbot.test`;
  const password = "e2e-" + crypto.randomBytes(9).toString("hex");

  let r = await fetch(`${SUPABASE}/auth/v1/signup`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const session = await r.json();
  if (!session.access_token) throw new Error("signup failed: " + JSON.stringify(session).slice(0, 300));
  const userId = session.user.id;

  const cookieValue =
    "base64-" +
    Buffer.from(
      JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        token_type: "bearer",
        expires_in: session.expires_in,
        expires_at: session.expires_at,
      })
    ).toString("base64");
  const cookie = `sb-${REF}-auth-token=${cookieValue}`;

  const call = async (method, path, body) => {
    const res = await fetch(`${APP}${path}`, {
      method,
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {}
    return { status: res.status, data };
  };

  r = await call("POST", "/api/sites", {
    business_name: "E2E Cred Test Cafe",
    category: "cafe",
    instructions: "temporary test site",
  });
  if (r.status !== 201) throw new Error("site create failed: " + JSON.stringify(r.data));
  const siteId = r.data.id;
  console.log(`site created: ${r.data.slug} (${siteId})`);

  r = await call("GET", `/api/sites/${siteId}/credentials`);
  if (r.status !== 403) throw new Error("expected 403 locked, got " + r.status + " " + JSON.stringify(r.data));
  console.log("credentials locked before 2FA: ok");

  r = await call("POST", "/api/totp", { action: "setup" });
  if (r.status !== 200 || !r.data.secret) throw new Error("totp setup failed: " + JSON.stringify(r.data));
  const secret = r.data.secret;
  if (!/^[A-Z2-7]+$/.test(secret)) throw new Error("secret is not base32: " + secret);
  console.log("totp setup ok (qr " + (r.data.qr ? "present" : "MISSING") + ")");

  r = await call("POST", "/api/totp", { action: "confirm", code: totpAt(secret, Math.floor(Date.now() / 1000)) });
  if (r.status !== 200) throw new Error("confirm failed: " + JSON.stringify(r.data));
  console.log("totp confirmed with live code: ok");

  const good = totpAt(secret, Math.floor(Date.now() / 1000));
  const bad = good === "000000" ? "999999" : "000000";
  r = await call("POST", "/api/totp", { action: "unlock", code: bad });
  if (r.status !== 400) throw new Error("expected 400 for wrong code, got " + r.status);
  console.log("wrong code rejected: ok");

  r = await call("POST", "/api/totp", { action: "unlock", code: good });
  if (r.status !== 200) throw new Error("unlock failed: " + JSON.stringify(r.data));
  console.log("unlocked until " + r.data.unlocked_until);

  r = await call("GET", `/api/sites/${siteId}/credentials`);
  if (r.status !== 200) throw new Error("credentials view failed: " + JSON.stringify(r.data));
  const cred = r.data;
  console.log("credentials viewed: username=" + cred.username + " password=" + cred.password);

  const pool = new Pool({ connectionString: e.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const row = (
    await pool.query("SELECT password_enc FROM site_admins WHERE site_id = $1", [siteId])
  ).rows[0];
  if (!row) throw new Error("no site_admins row for the test site");
  const key = Buffer.from(e.SITE_ADMIN_ENC_KEY.replace(/[^0-9a-fA-F]/g, ""), "hex");
  const [ivh, tagh, cth] = row.password_enc.split(".");
  const d = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivh, "hex"));
  d.setAuthTag(Buffer.from(tagh, "hex"));
  const plain = Buffer.concat([d.update(Buffer.from(cth, "hex")), d.final()]).toString("utf8");
  if (plain !== cred.password) throw new Error("API password does not match the decrypted DB blob");
  console.log("DB blob decrypts to the same password: ok");

  r = await call("POST", `/api/sites/${siteId}/credentials`);
  if (r.status !== 200 || !r.data.password) throw new Error("rotate failed: " + JSON.stringify(r.data));
  if (r.data.password === cred.password) throw new Error("rotate returned the same password");
  console.log("password rotation: ok");

  const audits = await pool.query(
    "SELECT action FROM audit_log WHERE actor_id = $1 AND action IN ('totp_enabled','credentials_unlocked','credentials_viewed','password_rotated')",
    [userId]
  );
  const actions = audits.rows.map((x) => x.action).join(",");
  if (!actions.includes("totp_enabled") || !actions.includes("credentials_viewed") || !actions.includes("password_rotated")) {
    throw new Error("audit log missing entries, got: " + (actions || "(none)"));
  }
  console.log("audit log entries present: ok");
  await pool.end();

  console.log("E2E OK — cleanup: node scripts/cleanup-test-user.cjs " + userId + " " + email);
})().catch((e) => {
  console.error("E2E FAILED:", e.message);
  process.exit(1);
});

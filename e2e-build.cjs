const fs = require("fs");
const { Client } = require("/opt/builder/node_modules/pg");

const BASE = "http://127.0.0.1:3010";
const EMAIL = "qa.salon.1018@dukanbot.website";

function pwFor(email) {
  const txt = fs.readFileSync("/root/.dukan-migration/temp-passwords.txt", "utf8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^(.+?)\s+(\S+)$/);
    if (m && m[1].trim().toLowerCase() === email.toLowerCase()) return m[2];
  }
  throw new Error("password not found in temp-passwords.txt");
}

function env() {
  return Object.fromEntries(
    fs.readFileSync("/opt/builder/.env.opencode", "utf8")
      .split("\n")
      .filter((l) => l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}

async function poll(siteId, buildId) {
  const c = new Client({ connectionString: env().DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 30000));
    const b = await c.query(
      "SELECT status, failure_reason, finished_at FROM builds WHERE id = $1",
      [buildId]
    );
    const row = b.rows[0];
    console.log("POLL", new Date().toISOString(), JSON.stringify(row));
    if (!row || ["ready", "failed", "cancelled", "interrupted"].includes(row.status)) {
      await c.end();
      return row;
    }
  }
  await c.end();
  return null;
}

async function main() {
  const password = pwFor(EMAIL);
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password }),
  });
  if (!login.ok) {
    console.log("LOGIN_FAIL", login.status, await login.text());
    return;
  }
  const cookies = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  console.log("LOGIN_OK");

  const site = await fetch(`${BASE}/api/sites`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookies },
    body: JSON.stringify({
      business_name: "E2E Verify Cafe",
      category: "cafe",
      instructions: "Small cafe website with a menu section, about section and contact details.",
    }),
  });
  const sj = await site.json();
  if (!site.ok) {
    console.log("SITE_FAIL", site.status, JSON.stringify(sj));
    return;
  }
  console.log("SITE_OK", JSON.stringify(sj));

  const build = await fetch(`${BASE}/api/sites/${sj.id}/build`, {
    method: "POST",
    headers: { cookie: cookies },
  });
  const bj = await build.json();
  if (!build.ok) {
    console.log("BUILD_FAIL", build.status, JSON.stringify(bj));
    return;
  }
  console.log("BUILD_QUEUED", JSON.stringify(bj));

  const final = await poll(sj.id, bj.buildId);
  console.log("E2E_DONE", JSON.stringify({ siteId: sj.id, slug: sj.slug, buildId: bj.buildId, final }));
}

main().catch((e) => {
  console.error("E2E_ERR", e.message);
  process.exit(1);
});

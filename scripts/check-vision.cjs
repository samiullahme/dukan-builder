// Read-only: report design-reference pipeline state per brief + vision lines in build logs.
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

  const briefs = await pool.query(
    `SELECT b.id, b.site_id, s.business_name, b.design_image, b.design_notes, b.design_plan,
            length(coalesce(b.design_plan,'')) AS plan_len,
            (b.design_plan IS NOT NULL AND b.design_plan != '') AS has_plan,
            s.slug, s.status AS site_status
     FROM briefs b LEFT JOIN sites s ON s.id = b.site_id
     ORDER BY b.created_at DESC LIMIT 20`
  );

  for (const r of briefs.rows) {
    console.log(`--- ${r.business_name || "(unnamed)"} [site ${r.site_id}] [${r.slug}] [${r.site_status}]`);
    console.log(`    design_image: ${r.design_image || "(none)"}`);
    console.log(`    design_notes: ${r.design_notes ? r.design_notes.slice(0, 120) : "(none)"}`);
    console.log(`    has_plan: ${r.has_plan}  plan_len: ${r.plan_len}`);
    if (r.has_plan) {
      let plan = r.design_plan;
      if (typeof plan === "string") { try { plan = JSON.parse(plan); } catch { plan = null; } }
      if (plan && typeof plan === "object") {
        const s = (v) => (typeof v === "string" ? v : JSON.stringify(v || null));
        console.log(`    plan.style: ${s(plan.style) || "(none)"}`);
        console.log(`    plan.palette: ${Array.isArray(plan.color_palette) ? plan.color_palette.join(", ") : "(none)"}`);
        console.log(`    plan.sections: ${Array.isArray(plan.sections) ? plan.sections.map((x) => x && x.name).join(", ") : "(none)"}`);
        console.log(`    plan.typography: ${s(plan.typography) || "(none)"}`);
        console.log(`    plan.design_prompt head: ${s(plan.design_prompt).slice(0, 200)}`);
        console.log(`    plan.image_queries: ${Array.isArray(plan.image_queries) ? plan.image_queries.join(" | ") : "(none)"}`);
        console.log(`    plan.analyzed_at: ${s(plan.analyzed_at) || "(none)"}  model: ${s(plan.model) || "(none)"}`);
      } else {
        console.log(`    plan: unparsable (${String(r.design_plan).slice(0, 120)})`);
      }
    }
    const builds = await pool.query(
      `SELECT id, status, kind, created_at, coalesce(log,'') AS log
       FROM builds WHERE site_id = $1 ORDER BY created_at DESC LIMIT 3`,
      [r.site_id]
    );
    for (const b of builds.rows) {
      const markers = [];
      for (const needle of [
        "analyzing the uploaded design reference",
        "design plan ready",
        "vision analysis skipped",
        "vision model",
        "reference image",
        "design/plan.json",
      ]) {
        const i = b.log.indexOf(needle);
        if (i >= 0) {
          markers.push(`${needle} :: ${b.log.slice(Math.max(0, i - 60), i + 140).replace(/\n/g, " ")}`);
        }
      }
      console.log(`    build ${b.id.slice(0, 8)} ${b.status} (${b.kind}) ${b.created_at.toISOString()}: ${markers.length ? "\n      " + markers.join("\n      ") : "no vision markers in log"}`);
    }
    console.log("");
  }
  await pool.end();
})().catch((err) => { console.error("ERR", err.message); process.exit(1); });

import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import db from "../lib/db";
import {
  startServe,
  createSession,
  promptAsync,
  abortSession,
  waitForIdle,
  getSessionIdleMark,
  stopServe,
  lastAssistantText,
} from "../lib/agent";
import { renderBuildPrompt, renderRefinePrompt } from "../lib/prompts";
import { analyzeDesign, paletteFromPlan, type DesignPlan } from "../lib/vision";
import { fetchSiteMedia, isSiteMedia, type SiteMedia } from "../lib/media";
import { normalizeCategory } from "../lib/categories";
import { classifyFailure } from "../lib/failures";
import { usableModels } from "../lib/model-chain";
import { syncChrome } from "../lib/chrome";
import { snapshotBuild, restoreSnapshot, pruneHistory, hasSnapshot } from "../lib/history";
import { publishWorkspace } from "../lib/publish";
import { writeOpenCodeConfig } from "../lib/opencode-config";
import { sanitizeWorkspace } from "../lib/workspace-security";

const TENANTS_ROOT = process.env.TENANTS_ROOT || "/opt/tenants";
const BUILD_TIMEOUT_MS = Number(process.env.BUILD_TIMEOUT_MS || 1_800_000);
const REPAIR_TIMEOUT_MS = Number(process.env.REPAIR_TIMEOUT_MS || 600_000);
// Models tried in order; a failed or timed-out model falls through to the
// next one so a provider hiccup can't kill a build. Entries are
// provider-qualified, so OpenCode free models and paid providers can be mixed
// (e.g. "deepseek/deepseek-chat,opencode/deepseek-v4.1-flash-free"). Models
// whose provider has no API key configured are skipped per build.
const CONFIGURED_BUILD_MODELS = (
  process.env.OPENCODE_BUILD_MODELS ||
  "opencode/deepseek-v4.1-flash-free,opencode/nemotron-3.5-lightning-free,opencode/space-bunny-free,opencode/glm-5.3-flash-free"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const QA_SCRIPT = process.env.QA_SCRIPT || "/opt/builder/qa/qa-check.cjs";
const POLL_MS = 8000;
const EDITABLE = new Set(["site.json", "index.html", "styles.css"]);

let active = false;

// Log appends are serialized per build so lines never interleave out of order.
const logChain = new Map<string, Promise<void>>();

function appendLog(buildId: string, line: string): Promise<void> {
  const text = `[${new Date().toISOString()}] ${line}\n`;
  const prev = logChain.get(buildId) ?? Promise.resolve();
  const next = prev
    .then(() => db.prepare(`UPDATE builds SET log = right(log || ?, 50000) WHERE id = ?`).run(text, buildId))
    .then(() => {});
  logChain.set(buildId, next);
  return next;
}

function appendStage(buildId: string, stage: string): Promise<void> {
  return appendLog(buildId, `[stage:${stage}]`);
}

function ensureOpencodeConfig(workspace: string, model: string): void {
  writeOpenCodeConfig(workspace, model);
}

type TurnOutcome = {
  result: "idle" | "error" | "timeout";
  sessionId: string;
  failedModels: string[];
};

/**
 * Prompt the agent and wait for the turn to finish, falling back to the next
 * free model when one errors or times out. Each fallback attempt gets a fresh
 * session so a dead session can't poison the retry.
 */
async function runAgentTurn(
  buildId: string,
  workspace: string,
  serve: Awaited<ReturnType<typeof startServe>>,
  reuseSessionId: string | null,
  prompt: string,
  timeoutMs: number,
  title: string,
  models: string[]
): Promise<TurnOutcome> {
  const failedModels: string[] = [];
  for (let attempt = 0; attempt < models.length; attempt++) {
    const model = models[attempt];
    try {
      ensureOpencodeConfig(workspace, model);
    } catch (e: any) {
      await appendLog(buildId, "could not write opencode.json: " + e.message);
    }
    let sessionId: string | null = attempt === 0 ? reuseSessionId : null;
    if (sessionId) {
      await appendLog(buildId, "reusing agent session " + sessionId);
    } else {
      sessionId = await createSession(serve, `${title}${attempt ? ` — ${model}` : ""}`);
      await db.prepare(`UPDATE builds SET opencode_session_id = ? WHERE id = ?`).run(sessionId, buildId);
      await appendLog(buildId, "agent session " + sessionId);
    }
    const idleMark = await getSessionIdleMark(sessionId);
    const sentAt = Date.now();
    await appendLog(buildId, `agent model: ${model}${attempt ? " (fallback)" : ""}`);
    await promptAsync(serve, sessionId, prompt);
    const timeoutMin = Math.round(timeoutMs / 60_000);
    await appendLog(buildId, `prompt sent, waiting for the agent to go idle (up to ${timeoutMin} min)…`);
    const result = await waitForIdle(serve, sessionId, timeoutMs, idleMark, (t, d) => {
      void appendLog(buildId, `${t}: ${d}`);
    });
    await appendLog(buildId, `agent ${result} after ${Math.round((Date.now() - sentAt) / 1000)}s`);
    if (result === "idle") return { result, sessionId, failedModels };
    failedModels.push(`${model} (${result})`);
    if (result === "timeout") {
      try { await abortSession(serve, sessionId); } catch { /* best effort */ }
    }
    if (attempt + 1 < models.length) {
      await appendLog(buildId, `model ${model} failed — falling back to ${models[attempt + 1]}…`);
    }
  }
  return { result: "error", sessionId: "", failedModels };
}

async function failBuild(buildId: string, siteId: string, msg: string): Promise<void> {
  await appendLog(buildId, `[stage:failed] FAILED: ${msg}`);
  await db
    .prepare(`UPDATE builds SET status = 'failed', finished_at = now(), failure_reason = ? WHERE id = ?`)
    .run(classifyFailure(msg), buildId);
  await db.prepare(`UPDATE sites SET status = 'draft' WHERE id = ?`).run(siteId);
}

/** Snapshot every file the agent is not allowed to change (top level). */
function snapshotLocked(workspace: string): Map<string, Buffer> {
  const snap = new Map<string, Buffer>();
  for (const name of fs.readdirSync(workspace)) {
    if (EDITABLE.has(name) || name === "opencode.json" || name === "design") continue;
    const p = path.join(workspace, name);
    try {
      if (fs.lstatSync(p).isFile()) snap.set(name, fs.readFileSync(p));
    } catch {
      // ignore transient files
    }
  }
  return snap;
}

/** Public pages that must share the homepage's header and footer. */
const CHROME_PAGES = ["about.html", "services.html", "gallery.html", "contact.html"];

/** Undo any edits the agent made to locked files and remove invented pages/scripts. */
function restoreLocked(workspace: string, snap: Map<string, Buffer>): number {
  sanitizeWorkspace(workspace);
  let restored = 0;
  for (const [name, buf] of snap) {
    const p = path.join(workspace, name);
    let current: Buffer | null = null;
    try {
      current = fs.existsSync(p) ? fs.readFileSync(p) : null;
    } catch {
      current = null;
    }
    if (!current || !current.equals(buf)) {
      fs.writeFileSync(p, buf);
      restored++;
    }
  }
  for (const name of fs.readdirSync(workspace)) {
    if (!/\.(html|js|css)$/i.test(name)) continue;
    if (EDITABLE.has(name) || snap.has(name)) continue;
    fs.rmSync(path.join(workspace, name), { force: true });
    restored++;
  }
  return restored;
}

async function prepareDesign(
  buildId: string,
  workspace: string,
  brief: any
): Promise<DesignPlan | null> {
  let plan: DesignPlan | null = null;
  if (brief?.design_plan) {
    try {
      plan = JSON.parse(brief.design_plan);
    } catch {
      plan = null;
    }
  }
  const designDir = path.join(workspace, "design");
  const refs = fs.existsSync(designDir)
    ? fs.readdirSync(designDir).filter((f) => /^reference\.(png|jpg|jpeg|webp)$/i.test(f))
    : [];
  if (!plan && refs.length) {
    const imagePath = path.join(designDir, refs[0]);
    await appendLog(buildId, "analyzing the uploaded design reference with the vision model…");
    const res = await analyzeDesign(imagePath, workspace);
    if (res.ok) {
      plan = res.plan;
      await db.prepare(`UPDATE briefs SET design_plan = ? WHERE site_id = ?`).run(
        JSON.stringify(plan),
        brief.site_id
      );
      await appendLog(buildId, `design plan ready: style "${plan.style || "n/a"}", ${plan.sections.length} sections, ${plan.color_palette.length} colours`);
    } else {
      await appendLog(buildId, "vision analysis skipped: " + res.error);
    }
  }
  if (plan) {
    try {
      fs.mkdirSync(designDir, { recursive: true });
      fs.writeFileSync(path.join(designDir, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
    } catch {
      // non-fatal
    }
  }
  return plan;
}

/** Write the pre-fetched media (and design palette) into site.json. */
function mergeMedia(
  workspace: string,
  site: any,
  media: SiteMedia | null,
  plan: DesignPlan | null,
  applyPalette: boolean
): string[] {
  const sjPath = path.join(workspace, "site.json");
  const sj = JSON.parse(fs.readFileSync(sjPath, "utf8"));
  const notes: string[] = [];
  sj.slug = site.slug;
  sj.business_name = site.business_name;
  sj.category = normalizeCategory(site.category);
  if (media) {
    const fields = {
      hero_image: media.hero_image,
      hero_video: media.hero_video,
      about_image: media.about_image,
      gallery: media.gallery,
      media_credits: media.credits.map((c) => ({ name: c.name, url: c.url })),
    };
    for (const [k, v] of Object.entries(fields)) {
      if (JSON.stringify(sj[k]) !== JSON.stringify(v)) {
        (sj as any)[k] = v;
        notes.push(k);
      }
    }
  }
  if (applyPalette) {
    const palette = paletteFromPlan(plan);
    if (palette) {
      sj.palette = palette;
      notes.push("palette");
    }
  }
  if (notes.length) fs.writeFileSync(sjPath, JSON.stringify(sj, null, 2) + "\n");
  return notes;
}

async function downloadMediaFile(url: string, dest: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 10_000) return false;
    fs.writeFileSync(dest, buf);
    return true;
  } catch {
    return false;
  }
}

function localMediaOk(p: string): boolean {
  try {
    return fs.statSync(p).size >= 10_000;
  } catch {
    return false;
  }
}

/**
 * Pixabay hotlinks expire within days, so site.json must never reference
 * them. Every build downloads the stored media into <workspace>/media and
 * the merge below writes local paths; briefs.media keeps the remote URLs so
 * a rebuilt-from-scratch workspace can re-download. Slots whose download
 * fails fall back down the hero -> about -> gallery chain, and a merge with
 * almost nothing localized signals expired links to the caller.
 */
async function localizeMedia(workspace: string, media: SiteMedia): Promise<SiteMedia> {
  const dir = path.join(workspace, "media");
  fs.mkdirSync(dir, { recursive: true });
  const ext = (u: string, fallback: string) => {
    const m = /\.(jpe?g|png|webp)(?:\?|$)/i.exec(u);
    return m ? "." + m[1].toLowerCase().replace("jpeg", "jpg") : fallback;
  };
  const grab = async (slot: string, url: string, fallbackExt: string): Promise<string> => {
    if (!url) return "";
    const name = slot + ext(url, fallbackExt);
    const dest = path.join(dir, name);
    if (localMediaOk(dest)) return "/media/" + name;
    return (await downloadMediaFile(url, dest)) ? "/media/" + name : "";
  };

  const hero = await grab("hero", media.hero_image, ".jpg");
  const about = await grab("about", media.about_image, ".jpg");
  const gallery: string[] = [];
  for (let i = 0; i < media.gallery.length; i++) {
    const local = await grab("g" + i, media.gallery[i], ".jpg");
    if (local) gallery.push(local);
  }
  const video = await grab("video", media.hero_video, ".mp4");

  const pool = [hero, about, ...gallery].filter(Boolean);
  const out: SiteMedia = { ...media };
  out.hero_image = hero || pool[0] || "";
  out.about_image = about || pool.find((p) => p !== out.hero_image) || out.hero_image;
  out.gallery = gallery.filter((g) => g !== out.hero_image && g !== out.about_image);
  out.hero_video = video;
  return out;
}

function localizedImageCount(media: SiteMedia): number {
  return (media.hero_image ? 1 : 0) + media.gallery.length;
}

export function startBuildWorker(): void {
  const g = globalThis as any;
  if (g.__dukanBuildWorker) return;
  g.__dukanBuildWorker = true;
  recoverOrphanedBuilds();
  console.log("[build-worker] started (poll every 8s, one build at a time)");
  setInterval(() => {
    tick().catch((e) => console.error("[build-worker] tick failed:", e?.message));
  }, POLL_MS);
  tick().catch((e) => console.error("[build-worker] tick failed:", e?.message));
}

/**
 * A build marked 'building' when this process starts has no runner — the
 * previous process (or its child) died or was restarted mid-build. Without
 * this it would show "building" forever and block new builds for that site.
 */
function recoverOrphanedBuilds(): void {
  db
    .prepare(`SELECT id, site_id FROM builds WHERE status = 'building'`)
    .all<{ id: string; site_id: string }>()
    .then((rows) => {
      for (const row of rows) {
        failBuild(row.id, row.site_id, "build was interrupted by a server restart — please build again");
      }
    })
    .catch((e) => console.error("[build-worker] orphan recovery failed:", e?.message));
}

type QaResult = { ok: boolean; errors: string[]; warnings: number; outDir: string };

async function runSiteQa(workspace: string, buildId: string): Promise<QaResult> {
  const outDir = path.join("/opt/qa", path.basename(workspace), buildId);
  // Async on purpose: the QA browser calls /_api on this same app, so a
  // synchronous run blocks the event loop and every owner/customer API check
  // hangs until QA exits.
  await new Promise<void>((resolve) => {
    const child = spawn(process.execPath, [QA_SCRIPT, workspace, "--out", outDir], {
      env: { ...process.env, HOME: process.env.HOME || "/home/builder" },
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, 300_000);
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    child.once("close", done);
    child.once("error", done);
  });
  const errors: string[] = [];
  let warnings = 0;
  try {
    const rep = JSON.parse(fs.readFileSync(path.join(outDir, "report.json"), "utf8"));
    warnings = rep.counts?.warnings ?? 0;
    for (const c of rep.static?.checks || []) {
      if (c.level === "error") errors.push(`${c.check}: ${c.message}`);
    }
    for (const c of rep.browser?.checks || []) {
      if (c.level === "error") errors.push(`browser/${c.check}: ${c.message}`);
    }
  } catch {
    errors.push("QA report missing — the QA runner failed to produce a report");
  }
  return { ok: errors.length === 0, errors, warnings, outDir };
}

async function tick(): Promise<void> {
  if (active) return;
  const row = await db
    .prepare(`SELECT id FROM builds WHERE status = 'queued' ORDER BY created_at LIMIT 1`)
    .get<{ id: string }>();
  if (!row) return;
  active = true;
  try {
    await processBuild(row.id);
  } catch (e: any) {
    console.error("[build-worker] processBuild threw:", e?.message);
  } finally {
    active = false;
  }
}

async function processRevert(buildId: string, site: any, build: any, workspace: string): Promise<void> {
  sanitizeWorkspace(workspace);
  const sourceId = String(build.input || "").trim();
  await appendLog(buildId, `reverting "${site.business_name}" to build ${sourceId}`);
  if (!hasSnapshot(workspace, sourceId)) {
    await failBuild(buildId, site.id, `no saved version for build ${sourceId}`);
    return;
  }
  if (!restoreSnapshot(workspace, sourceId)) {
    await failBuild(buildId, site.id, `could not restore build ${sourceId}`);
    return;
  }
  try {
    const sj = JSON.parse(fs.readFileSync(path.join(workspace, "site.json"), "utf8"));
    if (!sj.business_name) throw new Error("site.json has no business_name");
    if (sj.slug !== site.slug) throw new Error("site.json slug changed");
  } catch (e: any) {
    await failBuild(buildId, site.id, "restored site.json failed the sanity check: " + e.message);
    return;
  }
  // The reverted state is itself saved, so this revert can be reverted too.
  snapshotBuild(workspace, buildId);
  const pruned = pruneHistory(workspace);
  if (pruned) await appendLog(buildId, `pruned ${pruned} old saved version(s)`);
  const wasPublished = site.status === "published";
  if (wasPublished) {
    try {
      publishWorkspace(workspace, site.slug);
      await appendLog(buildId, "published the reverted version");
    } catch (e: any) {
      await appendLog(buildId, "could not republish: " + e.message);
    }
  }
  await appendStage(buildId, "finished");
  await appendLog(buildId, `reverted to ${sourceId} (${wasPublished ? "live" : "ready to preview"})`);
  await db.prepare(`UPDATE builds SET status = 'ready', finished_at = now() WHERE id = ?`).run(buildId);
  await db.prepare(`UPDATE sites SET status = ? WHERE id = ?`).run(wasPublished ? "published" : "ready", site.id);
}

async function processBuild(buildId: string): Promise<void> {
  // Atomic claim: only one worker can take a queued build.
  const claimed = await db
    .prepare(`UPDATE builds SET status = 'building', started_at = now() WHERE id = ? AND status = 'queued'`)
    .run(buildId);
  if (claimed.changes === 0) return;

  let siteId = buildId;
  let serve: Awaited<ReturnType<typeof startServe>> | null = null;
  try {
    const build = await db.prepare(`SELECT * FROM builds WHERE id = ?`).get<any>(buildId);
    const site = await db.prepare(`SELECT * FROM sites WHERE id = ?`).get<any>(build.site_id);
    if (!site) {
      await failBuild(buildId, build.site_id, "site row disappeared");
      return;
    }
    siteId = site.id;
    const brief = await db.prepare(`SELECT * FROM briefs WHERE site_id = ?`).get<any>(site.id);
    const quota = await db
      .prepare(`SELECT builds_used, builds_allowed FROM quota WHERE user_id = ?`)
      .get<{ builds_used: number; builds_allowed: number }>(site.user_id);

    const workspace = path.join(TENANTS_ROOT, site.user_id, site.slug);
    if (!fs.existsSync(path.join(workspace, "index.html"))) {
      await failBuild(buildId, site.id, "workspace missing: " + workspace);
      return;
    }

    // Reverts are deterministic file restores — no agent, no quota, no QA.
    if (build.kind === "revert") {
      await processRevert(buildId, site, build, workspace);
      return;
    }

    // Quota is consumed when a full build starts; chat refinements are free.
    if (build.kind === "build") {
      if ((quota?.builds_used ?? 0) >= (quota?.builds_allowed ?? 5)) {
        await failBuild(buildId, site.id, "beta build quota exhausted");
        return;
      }
      await db.prepare(`UPDATE quota SET builds_used = builds_used + 1 WHERE user_id = ?`).run(site.user_id);
    }

    await appendStage(buildId, "prepare");
    await appendLog(buildId, `Starting ${build.kind} for "${site.business_name}" in ${workspace}`);

    const category = normalizeCategory(site.category || brief?.category);
    let designPlan: DesignPlan | null = null;
    let media: SiteMedia | null = null;
    if (build.kind === "build") {
      designPlan = await prepareDesign(buildId, workspace, brief);
      try {
        if (brief?.media) {
          const stored = JSON.parse(brief.media);
          if (isSiteMedia(stored)) media = stored;
        }
        if (media) {
          media = await localizeMedia(workspace, media);
          if (localizedImageCount(media) < 3) {
            await appendLog(buildId, "stored media links expired; refetching from Pixabay");
            media = null;
          }
        }
        if (!media) {
          media = await fetchSiteMedia({ category, plan: designPlan });
          await db.prepare(`UPDATE briefs SET media = ? WHERE site_id = ?`).run(JSON.stringify(media), site.id);
          await appendLog(buildId, `media ready from ${media.source}: ${media.gallery.length + 2} images${media.hero_video ? " + hero video" : ""}`);
          media = await localizeMedia(workspace, media);
        }
        const changed = mergeMedia(workspace, site, media, designPlan, true);
        if (changed.length) await appendLog(buildId, "site.json seeded with " + changed.join(", "));
      } catch (e: any) {
        await appendLog(buildId, "media preparation skipped: " + e.message);
      }
    } else if (brief?.media) {
      try {
        const stored = JSON.parse(brief.media);
        if (isSiteMedia(stored)) {
          media = await localizeMedia(workspace, stored);
          mergeMedia(workspace, site, media, null, false);
        }
      } catch {
        // keep whatever site.json already has
      }
    }

    // Locked files are restored after every agent turn, so the public pages and
    // both dashboards cannot be broken by design edits.
    const lockedSnapshot = snapshotLocked(workspace);

    const { usable: buildModels, skipped: skippedModels } = usableModels(CONFIGURED_BUILD_MODELS);
    if (skippedModels.length) {
      await appendLog(
        buildId,
        "model(s) skipped (no credentials): " + skippedModels.map((s) => `${s.model} — ${s.reason}`).join("; ")
      );
    }
    if (!buildModels.length) {
      await failBuild(
        buildId,
        site.id,
        "no usable build models — every model in OPENCODE_BUILD_MODELS is missing its API key"
      );
      return;
    }
    await appendLog(buildId, "build model chain: " + buildModels.join(" → "));

    serve = await startServe(workspace, buildModels);
    await appendLog(buildId, `opencode serve listening on 127.0.0.1:${serve.port}`);

    // business_name lives on `sites`, not `briefs`; the prompt needs both.
    const briefForPrompt = {
      ...brief,
      business_name: site.business_name,
      category,
      design_plan: designPlan ? JSON.stringify(designPlan) : brief?.design_plan || "",
    };
    const prompt =
      build.kind === "refine"
        ? renderRefinePrompt(briefForPrompt, build.input || "")
        : renderBuildPrompt(briefForPrompt);
    await appendStage(buildId, "agent");
    const turn = await runAgentTurn(
      buildId,
      workspace,
      serve,
      build.kind === "refine" ? build.opencode_session_id : null,
      prompt,
      BUILD_TIMEOUT_MS,
      `${site.business_name} — website ${build.kind}`,
      buildModels
    );
    const sessionId = turn.sessionId;
    if (turn.result !== "idle") {
      await failBuild(buildId, site.id, `agent failed with every model (${turn.failedModels.join(", ")})`);
      return;
    }

    // Locked pages/scripts are the guarantee that forms and dashboards work.
    const restored = restoreLocked(workspace, lockedSnapshot);
    if (restored) await appendLog(buildId, `restored ${restored} locked file(s) changed by the agent`);
    const chromeSync = syncChrome(workspace);
    if (chromeSync.pages) await appendLog(buildId, `synced the homepage menu/footer into ${chromeSync.pages} page(s)`);
    if (chromeSync.skipped.length) await appendLog(buildId, "menu/footer sync skipped: " + chromeSync.skipped.join(", "));
    try {
      const merged = mergeMedia(workspace, site, media, null, false);
      if (merged.length) await appendLog(buildId, "re-pinned media fields: " + merged.join(", "));
    } catch (e: any) {
      await appendLog(buildId, "could not re-pin media fields: " + e.message);
    }

    // Sanity check: site.json must still be valid and carry the business identity.
    try {
      const sj = JSON.parse(fs.readFileSync(path.join(workspace, "site.json"), "utf8"));
      if (!sj.business_name) throw new Error("site.json has no business_name");
      if (sj.slug !== site.slug) throw new Error("site.json slug changed");
    } catch (e: any) {
      await failBuild(buildId, site.id, "sanity check failed: " + e.message);
      return;
    }

    // Deterministic QA gate: real browser at 390/768/1440 — image URLs and
    // dimensions, broken images, horizontal overflow, padding, tap targets,
    // contrast, links and hydration. One repair turn is allowed.
    await appendStage(buildId, "qa");
    await appendLog(buildId, "running the browser QA check…");
    let qa = await runSiteQa(workspace, buildId);
    await appendLog(buildId, `QA: ${qa.errors.length} error(s), ${qa.warnings} warning(s) — ${qa.outDir}`);
    if (!qa.ok) {
      for (const err of qa.errors.slice(0, 12)) await appendLog(buildId, "  QA: " + err);
      await appendStage(buildId, "repair");
      const repairPrompt = `Automated QA found these problems with the site in this workspace:

${qa.errors.slice(0, 12).map((e) => "- " + e).join("\n")}

Fix ONLY these problems by editing site.json, index.html and styles.css. Every other file is locked. Keep the design, all business facts, every data-slot / data-slot-attr / data-slot-src / data-slot-href attribute and every required ID intact. Do NOT change media URLs. Do NOT start a server or fetch URLs — QA runs after you. Reply with one line when finished.`;
      await appendLog(buildId, "asking the AI to fix the QA issues…");
      const repairTurn = await runAgentTurn(
        buildId,
        workspace,
        serve,
        sessionId,
        repairPrompt,
        REPAIR_TIMEOUT_MS,
        `${site.business_name} — QA repair`,
        buildModels
      );
      const repair = repairTurn.result;
      await appendLog(buildId, `repair agent ${repair}`);
      if (repair !== "idle") {
        await failBuild(buildId, site.id, `QA failed and the repair turn failed (${repairTurn.failedModels.join(", ")})`);
        return;
      }
      const restoredAfterRepair = restoreLocked(workspace, lockedSnapshot);
      if (restoredAfterRepair) await appendLog(buildId, `restored ${restoredAfterRepair} locked file(s) after repair`);
      const chromeAfterRepair = syncChrome(workspace);
      if (chromeAfterRepair.pages) await appendLog(buildId, `re-synced the homepage menu/footer into ${chromeAfterRepair.pages} page(s)`);
      try {
        mergeMedia(workspace, site, media, null, false);
      } catch {
        // QA will surface any remaining site.json problem
      }
      // The agent server holds a few hundred MB and the final QA decides
      // pass/fail on a 2GB host — its late flows time out when memory is
      // tight. Full builds don't need the server after the repair turn.
      if (serve && build.kind === "build") {
        await appendLog(buildId, "stopping the agent server to free memory for the final QA");
        await stopServe(serve);
        serve = null;
      }
      await appendLog(buildId, "re-running the browser QA check…");
      qa = await runSiteQa(workspace, buildId);
      await appendLog(buildId, `QA after repair: ${qa.errors.length} error(s), ${qa.warnings} warning(s) — ${qa.outDir}`);
      if (!qa.ok) {
        await failBuild(buildId, site.id, "QA failed after repair: " + qa.errors[0]);
        return;
      }
    }

    // Capture the agent's summary reply for the chat UI (refinements).
    // Refines keep the agent server alive through QA, so serve is set here.
    if (build.kind === "refine" && serve) {
      const reply = await lastAssistantText(serve, sessionId);
      await db.prepare(`INSERT INTO chat_messages (id, site_id, role, content) VALUES (?,?,?,?)`).run(
        cryptoRandomId(),
        site.id,
        "assistant",
        reply || "Done — I applied your change."
      );
    }

    await appendStage(buildId, "finished");
    if (snapshotBuild(workspace, buildId)) {
      const pruned = pruneHistory(workspace);
      if (pruned) await appendLog(buildId, `pruned ${pruned} old saved version(s)`);
    } else {
      await appendLog(buildId, "could not save this version — one-click revert will be unavailable for it");
    }
    await appendLog(buildId, "finished successfully");
    await db.prepare(`UPDATE builds SET status = 'ready', finished_at = now() WHERE id = ?`).run(buildId);
    await db.prepare(`UPDATE sites SET status = 'ready' WHERE id = ?`).run(site.id);
  } catch (e: any) {
    await failBuild(buildId, siteId, e?.message || String(e));
  } finally {
    if (serve) await stopServe(serve);
    logChain.delete(buildId);
  }
}

function cryptoRandomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

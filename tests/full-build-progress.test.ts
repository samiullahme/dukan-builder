import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { deriveBuildProgress, type BuildProgressView } from "../lib/failures";

const dbState = {
  build: {
    id: "build-e2e-1",
    site_id: "site-e2e-1",
    kind: "build",
    status: "queued",
    log: "",
    started_at: "2026-10-25 19:00:00",
    finished_at: null as string | null,
    failure_reason: null as string | null,
  },
  site: {
    id: "site-e2e-1",
    user_id: "user-e2e-1",
    slug: "lahore-spice-house",
    business_name: "Lahore Spice House",
    category: "restaurant",
    status: "building",
  },
  brief: {
    site_id: "site-e2e-1",
    category: "restaurant",
    instructions: "Authentic Lahori karahi and charcoal grill in Gulberg.",
    address: "Main Boulevard Gulberg, Lahore",
    phone: "0300 1234567",
    hours: "Mon-Sun 12pm - 11pm",
    services: "Mutton Karahi | Freshly cooked in desi ghee | Rs 2,800\nChicken Tikka | Charcoal grilled | Rs 950\nGarlic Naan | Clay oven baked | Rs 180",
    colors: "warm",
    media: null as string | null,
    design_plan: null as string | null,
  },
  quota: {
    user_id: "user-e2e-1",
    builds_used: 0,
    builds_allowed: 5,
  },
  progressSnapshots: [] as BuildProgressView[],
};

vi.mock("../lib/db", () => ({
  default: {
    prepare: (sql: string) => ({
      run: async (...args: unknown[]) => {
        if (sql.includes("UPDATE builds SET status = 'building'")) {
          dbState.build.status = "building";
          return { changes: 1 };
        }
        if (sql.includes("UPDATE quota SET builds_used = builds_used + 1")) {
          dbState.quota.builds_used += 1;
          return { changes: 1 };
        }
        if (sql.includes("UPDATE briefs SET media = ?")) {
          dbState.brief.media = String(args[0]);
          return { changes: 1 };
        }
        if (sql.includes("UPDATE builds SET log = right(log || ?")) {
          const line = String(args[0]);
          dbState.build.log += line;
          if (line.includes("[stage:")) {
            const snap = deriveBuildProgress(dbState.build.status, dbState.build.log, 180);
            dbState.progressSnapshots.push(snap);
          }
          return { changes: 1 };
        }
        if (sql.includes("UPDATE builds SET status = 'ready'")) {
          dbState.build.status = "ready";
          dbState.build.finished_at = "2026-10-25 19:08:00";
          dbState.progressSnapshots.push(
            deriveBuildProgress("ready", dbState.build.log, 480)
          );
          return { changes: 1 };
        }
        if (sql.includes("UPDATE builds SET status = 'failed'")) {
          dbState.build.status = "failed";
          dbState.build.failure_reason = String(args[0]);
          return { changes: 1 };
        }
        if (sql.includes("UPDATE sites SET status = ?")) {
          dbState.site.status = String(args[0]);
          return { changes: 1 };
        }
        if (sql.includes("UPDATE sites SET status = 'ready'")) {
          dbState.site.status = "ready";
          return { changes: 1 };
        }
        return { changes: 1 };
      },
      get: async () => {
        if (sql.includes("FROM builds WHERE id = ?")) return dbState.build;
        if (sql.includes("FROM sites WHERE id = ?")) return dbState.site;
        if (sql.includes("FROM briefs WHERE site_id = ?")) return dbState.brief;
        if (sql.includes("FROM quota WHERE user_id = ?")) return dbState.quota;
        return undefined;
      },
      all: async () => [],
    }),
  },
}));

vi.mock("../lib/agent", () => ({
  startServe: vi.fn(async () => ({ port: 4199, url: "http://127.0.0.1:4199", proc: null })),
  createSession: vi.fn(async () => "ses-e2e-1"),
  getSessionIdleMark: vi.fn(async () => 0),
  promptAsync: vi.fn(async () => {}),
  waitForIdle: vi.fn(
    async (
      _serve: unknown,
      _sessionId: string,
      _timeoutMs: number,
      _idleMark: number,
      onProgress?: (t: string, d: string) => void
    ) => {
      onProgress?.("tool", "write index.html");
      onProgress?.("tool", "write styles.css");
      return "idle";
    }
  ),
  abortSession: vi.fn(async () => {}),
  stopServe: vi.fn(async () => {}),
  lastAssistantText: vi.fn(async () => "Built Lahore Spice House website."),
}));

import { processBuild } from "../worker/build-worker";

describe("full test build progress and workspace structure verification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("completes a full build to ready, transitions all 6 stages from doing to done with remaining count, and preserves homepage, styles, and site.json structure", async () => {
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dukan-full-build-"));
    const tenantsRoot = path.join(tmpRoot, "tenants");
    const qaOutRoot = path.join(tmpRoot, "qa");
    const ws = path.join(tenantsRoot, dbState.site.user_id, dbState.site.slug);
    const templateDir = path.resolve(__dirname, "../template");

    fs.mkdirSync(path.dirname(ws), { recursive: true });
    execFileSync("cp", ["-r", templateDir, ws]);

    // Replace __SITE_SLUG__ and seed initial site.json just as provisionWorkspace does
    for (const file of fs.readdirSync(ws)) {
      if (!file.endsWith(".html")) continue;
      const p = path.join(ws, file);
      const html = fs.readFileSync(p, "utf8");
      if (html.includes("__SITE_SLUG__")) {
        fs.writeFileSync(p, html.split("__SITE_SLUG__").join(dbState.site.slug));
      }
    }

    const initialSiteJson = JSON.parse(fs.readFileSync(path.join(ws, "site.json"), "utf8"));
    const initialSiteJsonKeys = Object.keys(initialSiteJson).sort();
    initialSiteJson.slug = dbState.site.slug;
    initialSiteJson.business_name = dbState.site.business_name;
    initialSiteJson.tagline = "Authentic Lahori Karahi & Charcoal Grill in Gulberg";
    initialSiteJson.category = "restaurant";
    initialSiteJson.phone = "0300 1234567";
    initialSiteJson.address = "Main Boulevard Gulberg, Lahore";
    initialSiteJson.hours = "Mon-Sun, 12pm - 11pm";
    initialSiteJson.about =
      "Lahore Spice House serves traditional karahi cooked fresh to order over high flame with hand-ground spices and clay-oven naan.";
    initialSiteJson.services = [
      { name: "Mutton Karahi", desc: "Freshly cooked in desi ghee", price: "Rs 2,800" },
      { name: "Chicken Tikka", desc: "Charcoal grilled over live coals", price: "Rs 950" },
      { name: "Garlic Naan", desc: "Clay oven baked to order", price: "Rs 180" },
    ];
    fs.writeFileSync(path.join(ws, "site.json"), JSON.stringify(initialSiteJson, null, 2) + "\n");

    const beforeIndexHtml = fs.readFileSync(path.join(ws, "index.html"), "utf8");
    const beforeStylesCss = fs.readFileSync(path.join(ws, "styles.css"), "utf8");

    // Mock image downloads with valid >=10KB PNG image buffers (1600x1000)
    const validImageBytes = Buffer.alloc(14_000, 0);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(validImageBytes, 0);
    validImageBytes.writeUInt32BE(1600, 16);
    validImageBytes.writeUInt32BE(1000, 20);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(validImageBytes, { status: 200 });
    });

    // Wrapper QA script that invokes real qa/qa-check.cjs with --no-browser
    const qaWrapper = path.join(tmpRoot, "qa-wrapper.cjs");
    const realQaScript = path.resolve(__dirname, "../qa/qa-check.cjs");
    fs.writeFileSync(
      qaWrapper,
      `const { spawnSync } = require("child_process");
const res = spawnSync(process.execPath, [${JSON.stringify(realQaScript)}, ...process.argv.slice(2), "--no-browser"], { stdio: "inherit" });
process.exit(res.status || 0);
`
    );

    process.env.TENANTS_ROOT = tenantsRoot;
    process.env.QA_OUT_ROOT = qaOutRoot;
    process.env.QA_SCRIPT = qaWrapper;

    try {
      await processBuild(dbState.build.id);

      expect(dbState.build.status).toBe("ready");
      expect(dbState.site.status).toBe("ready");
      expect(dbState.quota.builds_used).toBe(1);

      // Verify the 6 stages moved from doing -> done with decreasing remainingCount
      const remainingCounts = dbState.progressSnapshots.map((s) => s.remainingCount);
      // [stage:prepare] -> 5 remaining; [stage:agent] -> 3 remaining; [stage:wiring] -> 2 remaining; [stage:qa] -> 1 remaining; ready -> 0 remaining
      expect(remainingCounts).toContain(5);
      expect(remainingCounts).toContain(3);
      expect(remainingCounts).toContain(2);
      expect(remainingCounts).toContain(1);
      expect(remainingCounts[remainingCounts.length - 1]).toBe(0);

      const finalProgress = dbState.progressSnapshots[dbState.progressSnapshots.length - 1];
      expect(finalProgress.stages).toHaveLength(6);
      expect(finalProgress.stages.every((s) => s.state === "done")).toBe(true);
      expect(finalProgress.remainingCount).toBe(0);

      // Verify generated homepage, styles.css, and site.json structure are intact
      const afterIndexHtml = fs.readFileSync(path.join(ws, "index.html"), "utf8");
      const afterStylesCss = fs.readFileSync(path.join(ws, "styles.css"), "utf8");
      const afterSiteJson = JSON.parse(fs.readFileSync(path.join(ws, "site.json"), "utf8"));

      expect(afterIndexHtml).toBe(beforeIndexHtml);
      expect(afterStylesCss).toBe(beforeStylesCss);
      expect(Object.keys(afterSiteJson).sort()).toEqual(initialSiteJsonKeys);
      expect(afterSiteJson.slug).toBe("lahore-spice-house");
      expect(afterSiteJson.business_name).toBe("Lahore Spice House");
      expect(afterSiteJson.hero_image).toBe("/media/hero.jpg");
      expect(afterSiteJson.about_image).toBe("/media/about.jpg");
      expect(afterSiteJson.gallery.length).toBeGreaterThanOrEqual(3);
    } finally {
      delete process.env.TENANTS_ROOT;
      delete process.env.QA_OUT_ROOT;
      delete process.env.QA_SCRIPT;
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAgentEnv } from "../lib/agent-env";
import { startServe, stopServe } from "../lib/agent";
import { buildOpenCodeConfig } from "../lib/opencode-config";
import { analyzeDesign } from "../lib/vision";

vi.mock("../lib/db", () => ({
  default: {
    prepare: () => ({
      run: vi.fn().mockResolvedValue({ changes: 1 }),
      get: vi.fn().mockResolvedValue(undefined),
      all: vi.fn().mockResolvedValue([]),
    }),
  },
}));

import { restoreLocked, snapshotLocked } from "../worker/build-worker";

const tempDirs: string[] = [];
const originalOpencodeBin = process.env.OPENCODE_BIN;

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dukan-agent-env-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  if (originalOpencodeBin === undefined) delete process.env.OPENCODE_BIN;
  else process.env.OPENCODE_BIN = originalOpencodeBin;
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("OpenCode process security", () => {
  it("passes only the process basics and keys for selected providers", () => {
    const env = buildAgentEnv(["deepseek/chat"], {
      PATH: "/usr/bin",
      HOME: "/home/builder",
      TMPDIR: "/tmp",
      NODE_ENV: "test",
      DEEPSEEK_API_KEY: "test-deepseek-key",
      OPENAI_API_KEY: "test-openai-key",
      DATABASE_URL: "postgres://test.invalid/db",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
      SITE_ADMIN_ENC_KEY: "test-encryption-key",
      PIXABAY_API_KEY: "test-pixabay-key",
      EXTRA_SECRET: "test-extra-secret",
    });

    expect(Object.keys(env).sort()).toEqual([
      "DEEPSEEK_API_KEY",
      "HOME",
      "NODE_ENV",
      "PATH",
      "TMPDIR",
    ]);
    expect(env.DEEPSEEK_API_KEY).toBe("test-deepseek-key");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(env).not.toHaveProperty("SITE_ADMIN_ENC_KEY");
    expect(env).not.toHaveProperty("PIXABAY_API_KEY");
  });

  it("denies shell, external-directory, network, subagent, and non-workspace permissions", () => {
    const config = buildOpenCodeConfig("opencode/free-model");

    expect(config.permission).toEqual({
      read: "allow",
      edit: "allow",
      glob: "deny",
      grep: "deny",
      list: "deny",
      bash: "deny",
      task: "deny",
      external_directory: "deny",
      webfetch: "deny",
      websearch: "deny",
      codesearch: "deny",
      todowrite: "deny",
      todoread: "deny",
      question: "deny",
      lsp: "deny",
      doom_loop: "deny",
      skill: "deny",
    });
  });

  it("writes restrictive opencode.json before spawning opencode serve and opencode run, overwriting bash allow", async () => {
    const binDir = makeTempDir();
    const fakeBin = path.join(binDir, "fake-opencode");
    fs.writeFileSync(
      fakeBin,
      [
        `#!${process.execPath}`,
        `const fs = require("fs");`,
        `const path = require("path");`,
        `const cfgRaw = fs.readFileSync(path.join(process.cwd(), "opencode.json"), "utf8");`,
        `fs.writeFileSync(path.join(process.cwd(), "observed-at-spawn.json"), cfgRaw);`,
        `if (process.argv[2] === "serve") {`,
        `  process.stdout.write("listening on http://127.0.0.1:43210\\n");`,
        `  setInterval(() => {}, 1000);`,
        `} else {`,
        `  process.stdout.write(JSON.stringify({`,
        `    site_title: "Test Bakery",`,
        `    design_prompt: "Warm bakery layout with hero, services, gallery and contact sections in a clean editorial grid with generous spacing.",`,
        `    style: "warm editorial bakery",`,
        `    layout_description: "Hero followed by services and gallery",`,
        `    sections: [{ name: "hero", description: "Hero banner", text_content: "Fresh bread" }, { name: "services", description: "Menu", text_content: "Pastries" }],`,
        `    color_palette: ["#1a1a1a", "#c9a227", "#f7f3eb"],`,
        `    typography: "Playfair Display, Inter",`,
        `    image_queries: ["artisan bakery", "sourdough bread"],`,
        `    video_queries: []`,
        `  }) + "\\n");`,
        `  process.exit(0);`,
        `}`,
      ].join("\n"),
      { mode: 0o755 }
    );
    process.env.OPENCODE_BIN = fakeBin;

    // 1. Verify startServe overwrites an existing bash: "allow" config BEFORE spawning opencode serve.
    const serveWorkspace = makeTempDir();
    fs.writeFileSync(
      path.join(serveWorkspace, "opencode.json"),
      JSON.stringify({
        model: "legacy/model",
        permission: { bash: "allow", external_directory: "allow" },
      })
    );

    const handle = await startServe(serveWorkspace, ["opencode/test-build-model"]);
    try {
      const observedServe = JSON.parse(
        fs.readFileSync(path.join(serveWorkspace, "observed-at-spawn.json"), "utf8")
      );
      expect(observedServe.model).toBe("opencode/test-build-model");
      expect(observedServe.permission.bash).toBe("deny");
      expect(observedServe.permission.external_directory).toBe("deny");
    } finally {
      await stopServe(handle);
    }

    // 2. Verify analyzeDesign (runVision) overwrites an existing bash: "allow" config BEFORE spawning opencode run.
    const visionWorkspace = makeTempDir();
    const refImage = path.join(visionWorkspace, "reference.png");
    fs.writeFileSync(refImage, "fake-image");
    fs.writeFileSync(
      path.join(visionWorkspace, "opencode.json"),
      JSON.stringify({
        model: "legacy/model",
        permission: { bash: "allow", external_directory: "allow" },
      })
    );

    const visionRes = await analyzeDesign(refImage, visionWorkspace);
    expect(visionRes.ok).toBe(true);
    const observedVision = JSON.parse(
      fs.readFileSync(path.join(visionWorkspace, "observed-at-spawn.json"), "utf8")
    );
    expect(observedVision.permission.bash).toBe("deny");
    expect(observedVision.permission.external_directory).toBe("deny");
  });

  it("restores opencode.json after a build turn if modified or deleted, and starts a fresh opencode serve per build", async () => {
    const workspace = makeTempDir();
    fs.writeFileSync(path.join(workspace, "index.html"), "<!doctype html><title>Site</title>");
    fs.writeFileSync(path.join(workspace, "about.html"), "<!doctype html><title>About</title>");

    const snap = snapshotLocked(workspace, "opencode/test-model");
    expect(snap.has("opencode.json")).toBe(true);

    // Simulate the agent tampering with opencode.json during a build turn
    fs.writeFileSync(
      path.join(workspace, "opencode.json"),
      JSON.stringify({ model: "tampered", permission: { bash: "allow", external_directory: "allow" } })
    );
    expect(restoreLocked(workspace, snap)).toBe(1);
    const restoredCfg = JSON.parse(fs.readFileSync(path.join(workspace, "opencode.json"), "utf8"));
    expect(restoredCfg.model).toBe("opencode/test-model");
    expect(restoredCfg.permission.bash).toBe("deny");
    expect(restoredCfg.permission.external_directory).toBe("deny");

    // Simulate the agent deleting opencode.json during a build turn
    fs.unlinkSync(path.join(workspace, "opencode.json"));
    expect(restoreLocked(workspace, snap)).toBe(1);
    expect(fs.existsSync(path.join(workspace, "opencode.json"))).toBe(true);

    // Verify each startServe call spawns a distinct opencode serve process (never reused)
    const binDir = makeTempDir();
    const fakeBin = path.join(binDir, "fake-opencode-serve");
    fs.writeFileSync(
      fakeBin,
      [
        `#!${process.execPath}`,
        `process.stdout.write("listening on http://127.0.0.1:43211\\n");`,
        `setInterval(() => {}, 1000);`,
      ].join("\n"),
      { mode: 0o755 }
    );
    process.env.OPENCODE_BIN = fakeBin;

    const firstServe = await startServe(workspace, ["opencode/test-model"]);
    const firstPid = firstServe.proc.pid;
    await stopServe(firstServe);
    expect(firstServe.proc.exitCode !== null || firstServe.proc.signalCode !== null).toBe(true);

    const secondServe = await startServe(workspace, ["opencode/test-model"]);
    const secondPid = secondServe.proc.pid;
    await stopServe(secondServe);
    expect(secondPid).toBeDefined();
    expect(secondPid).not.toBe(firstPid);
  });
});

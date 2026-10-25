import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockAgentState = {
  onPrompt: null as ((modelIdx: number) => void) | null,
  waitBehavior: null as ((modelIdx: number, timeoutMs: number) => "idle" | "error" | "timeout") | null,
  startedModels: [] as string[],
};

vi.mock("../lib/db", () => ({
  default: {
    prepare: () => ({
      run: async () => ({ changes: 1 }),
      get: async () => undefined,
      all: async () => [],
    }),
  },
}));

vi.mock("../lib/agent", () => ({
  startServe: vi.fn(async (_workspace: string, models: string[]) => {
    mockAgentState.startedModels.push(models[0]);
    return {
      port: 4100 + mockAgentState.startedModels.length,
      url: `http://127.0.0.1:${4100 + mockAgentState.startedModels.length}`,
      proc: null,
    };
  }),
  createSession: vi.fn(async () => `ses-${mockAgentState.startedModels.length}`),
  getSessionIdleMark: vi.fn(async () => 0),
  promptAsync: vi.fn(async () => {
    const idx = mockAgentState.startedModels.length - 1;
    mockAgentState.onPrompt?.(idx);
  }),
  waitForIdle: vi.fn(async (_serve: unknown, _sessionId: string, timeoutMs: number) => {
    const idx = mockAgentState.startedModels.length - 1;
    return mockAgentState.waitBehavior ? mockAgentState.waitBehavior(idx, timeoutMs) : "idle";
  }),
  abortSession: vi.fn(async () => {}),
  stopServe: vi.fn(async () => {}),
  lastAssistantText: vi.fn(async () => "Done building site."),
}));

import {
  MAX_TOTAL_AGENT_MS,
  runAgentTurn,
  snapshotEditable,
  restoreEditable,
} from "../worker/build-worker";

function makeTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dukan-fallback-test-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<html><body>Original Home</body></html>");
  fs.writeFileSync(path.join(dir, "styles.css"), "body { color: #111; }");
  fs.writeFileSync(
    path.join(dir, "site.json"),
    JSON.stringify({ slug: "cafe-test", business_name: "Cafe Test" })
  );
  return dir;
}

describe("workspace reset before fallback and 20-minute agent time cap (items 8 & 9)", () => {
  beforeEach(() => {
    mockAgentState.onPrompt = null;
    mockAgentState.waitBehavior = null;
    mockAgentState.startedModels = [];
  });

  it("restores index.html, styles.css, and site.json from the pre-turn snapshot before a fallback model runs", async () => {
    const ws = makeTempWorkspace();
    const seenByFallback: Record<string, string> = {};

    try {
      mockAgentState.onPrompt = (idx) => {
        if (idx === 0) {
          // First model half-edits all 3 editable files before failing
          fs.writeFileSync(path.join(ws, "index.html"), "<html><body>HALF EDITED CORRUPT");
          fs.writeFileSync(path.join(ws, "styles.css"), "body { broken:");
          fs.writeFileSync(path.join(ws, "site.json"), "{ invalid json");
        } else if (idx === 1) {
          // Capture what the second (fallback) model sees at the start of its turn
          seenByFallback["index.html"] = fs.readFileSync(path.join(ws, "index.html"), "utf8");
          seenByFallback["styles.css"] = fs.readFileSync(path.join(ws, "styles.css"), "utf8");
          seenByFallback["site.json"] = fs.readFileSync(path.join(ws, "site.json"), "utf8");
          // Fallback model writes valid final output
          fs.writeFileSync(path.join(ws, "index.html"), "<html><body>Clean Fallback Home</body></html>");
        }
      };

      mockAgentState.waitBehavior = (idx) => (idx === 0 ? "error" : "idle");

      const outcome = await runAgentTurn(
        "build-fallback-reset",
        ws,
        "Build the website",
        MAX_TOTAL_AGENT_MS,
        "Test Build",
        ["opencode/model-primary", "opencode/model-fallback"]
      );

      expect(outcome.result).toBe("idle");
      expect(outcome.failedModels).toEqual(["opencode/model-primary (error)"]);
      // Fallback model saw the exact pre-turn files, not model 1's half-edited files
      expect(seenByFallback["index.html"]).toBe("<html><body>Original Home</body></html>");
      expect(seenByFallback["styles.css"]).toBe("body { color: #111; }");
      expect(seenByFallback["site.json"]).toBe(
        JSON.stringify({ slug: "cafe-test", business_name: "Cafe Test" })
      );
      // And final output from fallback model is preserved
      expect(fs.readFileSync(path.join(ws, "index.html"), "utf8")).toBe(
        "<html><body>Clean Fallback Home</body></html>"
      );
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("caps total agent time at 20 minutes, caps each fallback lower than the first attempt, and never exceeds the cap by starting another fallback", async () => {
    const ws = makeTempWorkspace();
    let simulatedNow = 1_000_000;

    try {
      mockAgentState.waitBehavior = (_idx, timeoutMs) => {
        // Simulate each attempt consuming its entire allotted timeout before timing out
        simulatedNow += timeoutMs;
        return "timeout";
      };

      const models = [
        "opencode/model-1",
        "opencode/model-2",
        "opencode/model-3",
        "opencode/model-4",
      ];

      // Even if caller passes 30 minutes (1_800_000 ms), total cap must be 20 minutes (1_200_000 ms)
      const outcome = await runAgentTurn(
        "build-time-cap",
        ws,
        "Build the website",
        30 * 60_000,
        "Test Build",
        models,
        { nowFn: () => simulatedNow }
      );

      expect(outcome.result).toBe("error");
      // First attempt capped at 12 minutes (720_000 ms), fallback 1 capped at 8 minutes (480_000 ms)
      expect(outcome.attemptTimeoutsMs.length).toBe(2);
      expect(outcome.attemptTimeoutsMs[0]).toBe(12 * 60_000);
      expect(outcome.attemptTimeoutsMs[1]).toBe(8 * 60_000);
      expect(outcome.attemptTimeoutsMs[1]).toBeLessThan(outcome.attemptTimeoutsMs[0]);

      // Total time spent across all attempts is exactly 20 minutes (never exceeded)
      const totalAllotted = outcome.attemptTimeoutsMs.reduce((a, b) => a + b, 0);
      expect(totalAllotted).toBeLessThanOrEqual(MAX_TOTAL_AGENT_MS);
      expect(outcome.elapsedMs).toBe(MAX_TOTAL_AGENT_MS);

      // Models 3 and 4 were never started because the 20-minute cap was reached
      expect(mockAgentState.startedModels).toEqual(["opencode/model-1", "opencode/model-2"]);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("caps fallback lower than first attempt even when the first attempt fails quickly", async () => {
    const ws = makeTempWorkspace();
    let simulatedNow = 5_000_000;

    try {
      mockAgentState.waitBehavior = (idx) => {
        if (idx === 0) {
          // Fails after just 30 seconds
          simulatedNow += 30_000;
          return "error";
        }
        simulatedNow += 60_000;
        return "idle";
      };

      const outcome = await runAgentTurn(
        "build-fast-fail",
        ws,
        "Build the website",
        MAX_TOTAL_AGENT_MS,
        "Test Build",
        ["opencode/model-1", "opencode/model-2"],
        { nowFn: () => simulatedNow }
      );

      expect(outcome.result).toBe("idle");
      expect(outcome.attemptTimeoutsMs).toHaveLength(2);
      // First attempt got 12m (720_000 ms); fallback got 8m (480_000 ms) < 12m
      expect(outcome.attemptTimeoutsMs[0]).toBe(12 * 60_000);
      expect(outcome.attemptTimeoutsMs[1]).toBe(8 * 60_000);
      expect(outcome.attemptTimeoutsMs[1]).toBeLessThan(outcome.attemptTimeoutsMs[0]);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("snapshotEditable and restoreEditable round-trip all 3 editable files", () => {
    const ws = makeTempWorkspace();
    try {
      const snap = snapshotEditable(ws);
      fs.writeFileSync(path.join(ws, "index.html"), "changed");
      fs.unlinkSync(path.join(ws, "styles.css"));
      const restored = restoreEditable(ws, snap);
      expect(restored).toBe(2);
      expect(fs.readFileSync(path.join(ws, "index.html"), "utf8")).toBe(
        "<html><body>Original Home</body></html>"
      );
      expect(fs.readFileSync(path.join(ws, "styles.css"), "utf8")).toBe("body { color: #111; }");
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

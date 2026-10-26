import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/db", () => ({
  default: {
    prepare: () => ({
      run: async () => ({ changes: 1 }),
      get: async () => undefined,
      all: async () => [],
    }),
  },
  tx: async (fn: any) => fn({ prepare: () => ({ run: async () => ({ changes: 1 }), get: async () => undefined }) }),
}));

import { renderBuildPrompt, renderRefinePrompt, type BriefData } from "../lib/prompts";
import { buildOpenCodeConfig } from "../lib/opencode-config";
import { runSiteQaExclusive } from "../worker/build-worker";

describe("build speed and token reduction optimizations", () => {
  it("denies glob, grep, and list in opencode config to stop wasteful exploration", () => {
    const config = buildOpenCodeConfig("opencode/test-model");
    expect(config.permission.read).toBe("allow");
    expect(config.permission.edit).toBe("allow");
    expect(config.permission.glob).toBe("deny");
    expect(config.permission.grep).toBe("deny");
    expect(config.permission.list).toBe("deny");
    expect(config.permission.bash).toBe("deny");
  });

  it("renderBuildPrompt and renderRefinePrompt do not request redundant file reads or read-back loops", () => {
    const brief: BriefData = {
      business_name: "Speedy Grill",
      instructions: "Best grill in town",
      address: "123 Main St",
      phone: "0300-1112233",
      hours: "10am - 10pm",
      services: "Seekh Kabab | Rs 500",
      colors: "amber",
      category: "restaurant",
    };

    const buildPrompt = renderBuildPrompt(brief);
    // Should NOT ask agent to read AGENTS.md or design/plan.json via tool calls
    expect(buildPrompt).not.toContain("FIRST: read AGENTS.md in this workspace");
    expect(buildPrompt).not.toContain("Then read site.json and design/plan.json");
    // Should NOT ask agent to read back files at the end
    expect(buildPrompt).not.toContain("read back the three files and confirm");
    expect(buildPrompt).toContain("Do not read back the files; automated browser QA runs immediately after you");

    const refinePrompt = renderRefinePrompt(brief, "Change primary color to blue");
    expect(refinePrompt).not.toContain("FIRST: read AGENTS.md in this workspace and follow it");
    expect(refinePrompt).not.toContain("Read back the changed files when done");
    expect(refinePrompt).toContain("Do not read back the files; automated browser QA runs immediately after you");
  });

  it("runSiteQaExclusive executes QA runs sequentially using the mutex", async () => {
    const order: string[] = [];

    // Mock QA calls by triggering concurrent runs
    // runSiteQaExclusive internally wraps the execution in a promise chain
    const p1 = runSiteQaExclusive("/tmp/nonexistent-1", "b1").then(() => {
      order.push("b1-done");
    });
    const p2 = runSiteQaExclusive("/tmp/nonexistent-2", "b2").then(() => {
      order.push("b2-done");
    });

    await Promise.all([p1, p2]);
    expect(order).toEqual(["b1-done", "b2-done"]);
  });
});

import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { DesignPlan } from "../lib/vision";

const storedBriefPlans: Array<{ site_id: string; design_plan: string }> = [];

vi.mock("../lib/db", () => ({
  default: {
    prepare: (sql: string) => ({
      run: async (...args: unknown[]) => {
        if (sql.includes("UPDATE briefs SET design_plan")) {
          const [planJson, siteId] = args as [string, string];
          const existing = storedBriefPlans.find((b) => b.site_id === siteId);
          if (existing) existing.design_plan = planJson;
          else storedBriefPlans.push({ site_id: siteId, design_plan: planJson });
        }
        return { changes: 1 };
      },
      get: async () => undefined,
      all: async () => {
        if (sql.includes("SELECT design_plan FROM briefs")) {
          return storedBriefPlans.filter((b) => b.design_plan);
        }
        return [];
      },
    }),
  },
}));

const visionCallMock = vi.fn<(imagePath: string, workspace: string) => Promise<DesignPlan>>();

vi.mock("../lib/vision", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/vision")>();
  return {
    ...actual,
    analyzeDesign: vi.fn(async (imagePath: string, workspace: string) => {
      const plan = await visionCallMock(imagePath, workspace);
      return { ok: true as const, plan };
    }),
  };
});

import { hashImageBytes, parseMatchingDesignPlan } from "../lib/vision";
import { prepareDesign } from "../worker/build-worker";

function makeWorkspaceWithImage(imageBytes: Buffer): string {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), "dukan-vision-cache-"));
  const designDir = path.join(ws, "design");
  fs.mkdirSync(designDir, { recursive: true });
  fs.writeFileSync(path.join(designDir, "reference.png"), imageBytes);
  return ws;
}

function samplePlan(label: string, imageHash: string): DesignPlan {
  return {
    site_title: label,
    design_prompt: `Detailed design prompt for ${label} with warm lighting and editorial layout.`,
    style: `Warm editorial ${label}`,
    layout_description: "Hero followed by menu and booking",
    sections: [
      { name: "hero", description: "Full bleed hero", text_content: "Welcome" },
      { name: "services", description: "Grid of offerings", text_content: "Menu" },
    ],
    color_palette: ["#1a1a1a", "#c9a227", "#f7f3eb"],
    typography: "Playfair Display headings, Inter body",
    image_queries: ["artisan coffee", "warm cafe interior"],
    video_queries: [],
    model: "opencode/glm-5.3-flash-free",
    analyzed_at: "2026-10-25T12:00:00.000Z",
    image_hash: imageHash,
  };
}

describe("vision design plan cache by image byte hash (item 15)", () => {
  beforeEach(() => {
    storedBriefPlans.length = 0;
    visionCallMock.mockReset();
  });

  it("reuses the stored design plan when the same image bytes are re-uploaded and misses cache when image bytes differ", async () => {
    const imageBytesA = Buffer.from("reference-image-bytes-version-A-89504e47");
    const imageBytesB = Buffer.from("reference-image-bytes-version-B-different");
    const hashA = hashImageBytes(imageBytesA);
    const hashB = hashImageBytes(imageBytesB);
    expect(hashA).not.toBe(hashB);

    const ws1 = makeWorkspaceWithImage(imageBytesA);
    const ws2 = makeWorkspaceWithImage(imageBytesA);

    try {
      visionCallMock.mockImplementation(async (imgPath) => {
        const h = hashImageBytes(imgPath);
        return samplePlan(h === hashA ? "Design A" : "Design B", h);
      });

      // 1. First upload of image A -> cache miss -> calls vision model once
      const plan1 = await prepareDesign("build-1", ws1, {
        site_id: "site-1",
        design_plan: null,
      });
      expect(visionCallMock).toHaveBeenCalledTimes(1);
      expect(plan1?.site_title).toBe("Design A");
      expect(plan1?.image_hash).toBe(hashA);

      // Verify design/plan.json and briefs.design_plan both hold image_hash
      const diskPlan1 = JSON.parse(
        fs.readFileSync(path.join(ws1, "design", "plan.json"), "utf8")
      ) as DesignPlan;
      expect(diskPlan1.image_hash).toBe(hashA);
      expect(parseMatchingDesignPlan(storedBriefPlans[0]?.design_plan, hashA)?.site_title).toBe(
        "Design A"
      );

      // 2. Re-running on site-1 with the same image A -> cache hit -> vision model NOT called again
      const plan1Again = await prepareDesign("build-2", ws1, {
        site_id: "site-1",
        design_plan: storedBriefPlans[0]?.design_plan,
      });
      expect(visionCallMock).toHaveBeenCalledTimes(1);
      expect(plan1Again?.site_title).toBe("Design A");
      expect(plan1Again?.image_hash).toBe(hashA);

      // 3. Re-uploading the exact same image A on a brand-new site-2 (empty brief.design_plan) -> cache hit from briefs.design_plan -> vision model NOT called
      const plan2SameImage = await prepareDesign("build-3", ws2, {
        site_id: "site-2",
        design_plan: null,
      });
      expect(visionCallMock).toHaveBeenCalledTimes(1);
      expect(plan2SameImage?.site_title).toBe("Design A");
      expect(plan2SameImage?.image_hash).toBe(hashA);

      // 4. Uploading a DIFFERENT image B on site-1 (even though brief.design_plan and design/plan.json hold Design A) -> cache miss -> calls vision model!
      fs.writeFileSync(path.join(ws1, "design", "reference.png"), imageBytesB);
      const plan1NewImage = await prepareDesign("build-4", ws1, {
        site_id: "site-1",
        design_plan: storedBriefPlans[0]?.design_plan,
      });
      expect(visionCallMock).toHaveBeenCalledTimes(2);
      expect(plan1NewImage?.site_title).toBe("Design B");
      expect(plan1NewImage?.image_hash).toBe(hashB);

      const diskPlanAfterB = JSON.parse(
        fs.readFileSync(path.join(ws1, "design", "plan.json"), "utf8")
      ) as DesignPlan;
      expect(diskPlanAfterB.image_hash).toBe(hashB);
    } finally {
      fs.rmSync(ws1, { recursive: true, force: true });
      fs.rmSync(ws2, { recursive: true, force: true });
    }
  });
});

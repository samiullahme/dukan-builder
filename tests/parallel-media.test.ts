import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { SiteMedia } from "../lib/media";

vi.mock("../lib/db", () => ({
  default: {
    prepare: () => ({
      run: async () => ({ changes: 1 }),
      get: async () => undefined,
      all: async () => [],
    }),
  },
}));

import {
  localizeMedia,
  localizedImageCount,
  mergeMedia,
  MEDIA_DOWNLOAD_CONCURRENCY,
} from "../worker/build-worker";

function makeTempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dukan-media-test-"));
  fs.writeFileSync(
    path.join(dir, "site.json"),
    JSON.stringify({ slug: "bistro-one", business_name: "Bistro One", category: "restaurant" })
  );
  return dir;
}

describe("parallel media downloads (item 14)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("downloads hero, about, and gallery images in parallel with concurrency <= 4 and preserves order in site.json", async () => {
    const ws = makeTempWorkspace();
    let activeDownloads = 0;
    let maxConcurrent = 0;

    // Deliberately make earlier images resolve slower than later images to test ordering
    const delays: Record<string, number> = {
      "https://cdn.example.com/hero.jpg": 45,
      "https://cdn.example.com/about.jpg": 40,
      "https://cdn.example.com/g0.jpg": 50,
      "https://cdn.example.com/g1.jpg": 10,
      "https://cdn.example.com/g2.jpg": 35,
      "https://cdn.example.com/g3.jpg": 5,
      "https://cdn.example.com/g4.jpg": 25,
      "https://cdn.example.com/g5.jpg": 15,
    };

    const payload = Buffer.alloc(12_000, 0x42);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      activeDownloads++;
      if (activeDownloads > maxConcurrent) {
        maxConcurrent = activeDownloads;
      }
      const waitMs = delays[url] ?? 10;
      await new Promise((r) => setTimeout(r, waitMs));
      activeDownloads--;
      return new Response(payload, { status: 200 });
    });

    try {
      const media: SiteMedia = {
        hero_image: "https://cdn.example.com/hero.jpg",
        about_image: "https://cdn.example.com/about.jpg",
        gallery: [
          "https://cdn.example.com/g0.jpg",
          "https://cdn.example.com/g1.jpg",
          "https://cdn.example.com/g2.jpg",
          "https://cdn.example.com/g3.jpg",
          "https://cdn.example.com/g4.jpg",
          "https://cdn.example.com/g5.jpg",
        ],
        hero_video: "",
        credits: [{ name: "Test Photographer", url: "https://pixabay.com", source: "Pixabay" }],
        source: "pixabay",
        fetched_at: new Date().toISOString(),
      };

      const localized = await localizeMedia(ws, media);

      // Verify parallel execution with max concurrency of 4
      expect(MEDIA_DOWNLOAD_CONCURRENCY).toBe(4);
      expect(maxConcurrent).toBeGreaterThan(1);
      expect(maxConcurrent).toBeLessThanOrEqual(4);

      // Verify exact gallery order is preserved despite out-of-order completion times
      expect(localized.hero_image).toBe("/media/hero.jpg");
      expect(localized.about_image).toBe("/media/about.jpg");
      expect(localized.gallery).toEqual([
        "/media/g0.jpg",
        "/media/g1.jpg",
        "/media/g2.jpg",
        "/media/g3.jpg",
        "/media/g4.jpg",
        "/media/g5.jpg",
      ]);

      // Verify site.json receives the exact ordered gallery
      mergeMedia(
        ws,
        { slug: "bistro-one", business_name: "Bistro One", category: "restaurant" },
        localized,
        null,
        false
      );
      const sj = JSON.parse(fs.readFileSync(path.join(ws, "site.json"), "utf8"));
      expect(sj.hero_image).toBe("/media/hero.jpg");
      expect(sj.about_image).toBe("/media/about.jpg");
      expect(sj.gallery).toEqual([
        "/media/g0.jpg",
        "/media/g1.jpg",
        "/media/g2.jpg",
        "/media/g3.jpg",
        "/media/g4.jpg",
        "/media/g5.jpg",
      ]);
      expect(localizedImageCount(localized)).toBe(7);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("reports fewer than 3 localized images when downloads fail so the caller refetches", async () => {
    const ws = makeTempWorkspace();
    const payload = Buffer.alloc(12_000, 0x42);

    // Only 2 URLs succeed (hero + g2); everything else returns 404
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.endsWith("hero.jpg") || url.endsWith("g2.jpg")) {
        return new Response(payload, { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    });

    try {
      const media: SiteMedia = {
        hero_image: "https://cdn.example.com/hero.jpg",
        about_image: "https://cdn.example.com/about.jpg",
        gallery: [
          "https://cdn.example.com/g0.jpg",
          "https://cdn.example.com/g1.jpg",
          "https://cdn.example.com/g2.jpg",
        ],
        hero_video: "",
        credits: [],
        source: "pixabay",
        fetched_at: new Date().toISOString(),
      };

      const localized = await localizeMedia(ws, media);
      // hero takes /media/hero.jpg, about falls back to /media/g2.jpg, leaving gallery empty -> count = 1 (< 3)
      expect(localizedImageCount(localized)).toBeLessThan(3);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

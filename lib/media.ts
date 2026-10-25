import { getCategory, type CategoryKey } from "./categories";
import type { DesignPlan } from "./vision";

export type MediaCredit = { name: string; url: string; source: string };

export type SiteMedia = {
  hero_image: string;
  about_image: string;
  gallery: string[];
  hero_video: string;
  credits: MediaCredit[];
  source: "pixabay" | "fallback";
  fetched_at: string;
};

type PixabayImage = {
  id: number;
  pageURL: string;
  fullHDURL?: string;
  largeImageURL?: string;
  webformatURL?: string;
  imageWidth: number;
  imageHeight: number;
  user: string;
};

type PixabayVideo = {
  id: number;
  pageURL: string;
  user: string;
  videos?: Record<string, { url: string; width: number; height: number } | undefined>;
};

const PIXABAY_KEY = process.env.PIXABAY_API_KEY || "";

// Pixabay ranks by popularity over OR-matched tokens, so long natural-language
// queries surface wildly irrelevant popular photos (a "chicken karahi" query
// once returned an egg-carton photo via its "chicken eggs" tag). Searching with
// 2-4 keyword tokens and accepting a hit only when its tags overlap the query
// keeps results on-topic.
const STOPWORDS = new Set([
  "a", "an", "the", "in", "on", "of", "with", "and", "or", "for", "at", "by",
  "to", "from", "up", "over", "under", "into", "near", "side", "is", "are",
  "close", "closer", "closed", "full", "big", "small", "beautiful", "modern",
  "authentic", "traditional", "best", "popular", "perfect", "fresh", "freshly",
  "hot", "cold", "warm", "dark", "black", "white", "bright", "clean", "new",
  "old", "good", "great", "nice", "view", "shot", "shots", "angle", "photo",
  "photos", "image", "images", "picture", "pictures", "background",
  "backgrounds", "wallpaper", "wallpapers", "desktop", "laptop", "free",
  "hd", "4k", "screen", "closeup", "overhead", "top", "slow", "motion",
  "food", "foods", "dish", "dishes", "meal", "meals", "cuisine",
  "sizzling", "steaming", "piled", "tossing", "baked", "grilled", "roasted",
  "fried", "plated", "served", "cooked", "garnished", "colorful", "colourful",
  "smiling", "sitting", "standing", "looking", "examining", "wearing",
  "holding", "eating", "cooking", "pouring", "cozy", "rustic", "elegant",
  "luxurious", "luxury", "stylish", "decorated", "lit", "copper",
  "pakistani", "pakistan", "india", "indian",
]);

function keywordsOf(q: string): string[] {
  const words = q
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if (STOPWORDS.has(w) || w.length < 3) continue;
    if (!out.includes(w)) out.push(w);
    if (out.length >= 4) break;
  }
  return out;
}

function tagsInclude(tags: string, keyword: string): boolean {
  // match the keyword plus common plural forms so "spice" also matches "spices"
  const base = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${base}(s|es|ies)?\\b`, "i").test(tags);
}

/** True when the hit's tags overlap the query keywords enough to be relevant. */
function hitMatchesQuery(hit: PixabayImage, keywords: string[], need: number): boolean {
  if (keywords.length === 0) return false;
  const tags = (hit as any).tags || "";
  return keywords.filter((k) => tagsInclude(tags, k)).length >= need;
}

/**
 * Search with the keyword list, then progressively shorter versions, so a
 * polluted query like "steaming biryani copper handi" still recovers to
 * "biryani" when nothing matches the full keyword set.
 */
// Ingredient words are ambiguous alone: "chicken karahi" falling back to
// "chicken" returns farm animals and chicks instead of the dish. Try the
// specific words first so the fallback stays on-topic.
const GENERIC_INGREDIENT_TOKENS = new Set([
  "chicken", "mutton", "beef", "lamb", "goat", "fish", "prawn", "prawns",
  "shrimp", "crab", "egg", "eggs", "meat", "milk",
]);

async function searchAccepted(keywords: string[]): Promise<PixabayImage[]> {
  const trials: string[][] = [];
  for (const n of [keywords.length, 2]) {
    const trial = keywords.slice(0, n);
    if (trial.length && !trials.some((t) => t.join(" ") === trial.join(" "))) trials.push(trial);
  }
  const singles = [...keywords].sort(
    (a, b) => Number(GENERIC_INGREDIENT_TOKENS.has(a)) - Number(GENERIC_INGREDIENT_TOKENS.has(b))
  );
  for (const k of singles) {
    if (!trials.some((t) => t.join(" ") === k)) trials.push([k]);
  }
  for (const trial of trials) {
    const hits = await searchImages(trial.join(" "));
    const need = trial.length === 1 ? 1 : 2;
    const accepted = hits.filter((h) => hitMatchesQuery(h, trial, need));
    if (accepted.length) return accepted;
  }
  return [];
}

async function pixabayJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function searchImages(query: string): Promise<PixabayImage[]> {
  if (!PIXABAY_KEY) return [];
  const params = new URLSearchParams({
    key: PIXABAY_KEY,
    q: query,
    image_type: "photo",
    orientation: "horizontal",
    safesearch: "true",
    per_page: "12",
    min_width: "1200",
    order: "popular",
  });
  const data = await pixabayJson(`https://pixabay.com/api/?${params.toString()}`);
  return Array.isArray(data?.hits) ? (data.hits as PixabayImage[]) : [];
}

async function searchVideos(query: string): Promise<PixabayVideo[]> {
  if (!PIXABAY_KEY) return [];
  const params = new URLSearchParams({
    key: PIXABAY_KEY,
    q: query,
    safesearch: "true",
    per_page: "3",
    video_type: "film",
  });
  const data = await pixabayJson(`https://pixabay.com/api/videos/?${params.toString()}`);
  return Array.isArray(data?.hits) ? (data.hits as PixabayVideo[]) : [];
}

function imageUrl(hit: PixabayImage): string {
  return hit.fullHDURL || hit.largeImageURL || hit.webformatURL || "";
}

function videoUrl(hit: PixabayVideo): string {
  const v = hit.videos || {};
  const pick = v.large?.width && v.large.width >= 1280 ? v.large : v.medium || v.small;
  return pick?.url || "";
}

function curatedFallback(category: CategoryKey): SiteMedia {
  const def = getCategory(category);
  const U = (id: string) => `https://images.unsplash.com/photo-${id}?q=80&w=1600&auto=format&fit=crop`;
  const images = def.fallback.map(U);
  return {
    hero_image: images[0] || "",
    about_image: images[1] || images[0] || "",
    gallery: images.slice(2, 8),
    hero_video: "",
    credits: [{ name: "Stock photography from Unsplash", url: "https://unsplash.com", source: "Unsplash" }],
    source: "fallback",
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Resolve media BEFORE the agent runs, from Pixabay when available. The agent
 * receives exact URLs and is forbidden from inventing its own.
 */
export async function fetchSiteMedia(input: {
  category: CategoryKey;
  plan: DesignPlan | null;
}): Promise<SiteMedia> {
  const def = getCategory(input.category);
  const queries: string[] = [];
  for (const q of [...(input.plan?.image_queries || []), ...def.mediaQueries]) {
    const keywords = keywordsOf(q);
    if (keywords.length === 0) continue;
    const clean = keywords.join(" ");
    if (!queries.some((x) => x === clean)) queries.push(clean);
    if (queries.length >= 6) break;
  }

  if (!PIXABAY_KEY) return curatedFallback(input.category);

  const seen = new Set<number>();
  const images: PixabayImage[] = [];
  for (const q of queries) {
    const hits = await searchAccepted(q.split(" "));
    for (const hit of hits) {
      if (!seen.has(hit.id) && imageUrl(hit)) {
        seen.add(hit.id);
        images.push(hit);
      }
    }
    if (images.length >= 10) break;
  }

  if (images.length < 4) return curatedFallback(input.category);

  const heroHit = images.find((h) => h.imageWidth >= h.imageHeight * 1.25) || images[0];
  const rest = images.filter((h) => h.id !== heroHit.id);
  const aboutHit = rest.shift() || heroHit;
  const galleryHits = rest.slice(0, 6);
  const credits: MediaCredit[] = [];
  const addCredit = (hit: PixabayImage) => {
    const name = `Photo by ${hit.user || "Pixabay contributor"} on Pixabay`;
    if (!credits.some((c) => c.name === name)) credits.push({ name, url: hit.pageURL, source: "Pixabay" });
  };
  [heroHit, aboutHit, ...galleryHits].forEach(addCredit);

  let hero_video = "";
  const videoQuery = (input.plan?.video_queries || [])[0] || def.mediaQueries[0];
  if (videoQuery) {
    const videos = await searchVideos(keywordsOf(videoQuery).join(" "));
    for (const v of videos) {
      const url = videoUrl(v);
      if (url) {
        hero_video = url;
        const name = `Video by ${v.user || "Pixabay contributor"} on Pixabay`;
        if (!credits.some((c) => c.name === name)) credits.push({ name, url: v.pageURL, source: "Pixabay" });
        break;
      }
    }
  }

  return {
    hero_image: imageUrl(heroHit),
    about_image: imageUrl(aboutHit),
    gallery: galleryHits.map(imageUrl).filter(Boolean),
    hero_video,
    credits,
    source: "pixabay",
    fetched_at: new Date().toISOString(),
  };
}

export function isSiteMedia(v: unknown): v is SiteMedia {
  return !!v && typeof v === "object" && typeof (v as SiteMedia).hero_image === "string";
}

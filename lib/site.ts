import db from "./db";

export const RESERVED_SLUGS = new Set([
  "www", "api", "admin", "preview", "static", "assets", "builder", "dukan",
  "login", "signup", "dashboard", "sites", "site", "app", "blog", "help", "support",
]);

export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "site";
}

export async function uniqueSlug(base: string): Promise<string> {
  let slug = RESERVED_SLUGS.has(base) ? `${base}-shop` : base;
  const exists = async (s: string) => !!(await db.prepare("SELECT 1 FROM sites WHERE slug = ?").get(s));
  let n = 2;
  while (await exists(slug)) slug = `${base}-${n++}`;
  return slug;
}

export type SiteRow = {
  id: string;
  user_id: string;
  slug: string;
  business_name: string;
  category: string;
  status: string;
  created_at: string;
};

export async function getSiteForUser(siteId: string, userId: string): Promise<SiteRow | null> {
  return (
    (await db
      .prepare("SELECT * FROM sites WHERE id = ? AND user_id = ?")
      .get<SiteRow>(siteId, userId)) ?? null
  );
}

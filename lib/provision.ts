import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { CATEGORY_COLORS, getCategory, normalizeCategory, type CategoryKey } from "./categories";

const TENANTS_ROOT = process.env.TENANTS_ROOT || "/opt/tenants";
const TEMPLATE_DIR = process.env.TEMPLATE_DIR || "/opt/builder/template";

export type BriefInput = {
  business_name: string;
  instructions: string;
  address: string;
  phone: string;
  hours: string;
  services: string;
  colors: string;
  category: CategoryKey;
  design_image?: string;
  design_image_mime?: string;
  design_notes?: string;
};

type Service = { name: string; desc: string; price: string };

function servicesFromText(services: string): Service[] {
  const lines = services.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 9);
  if (lines.length === 0) {
    return [
      { name: "Service one", desc: "Describe what you offer.", price: "" },
      { name: "Service two", desc: "Describe what you offer.", price: "" },
      { name: "Service three", desc: "Describe what you offer.", price: "" },
    ];
  }
  return lines.map((line) => {
    const parts = line.split("|").map((p) => p.trim());
    let name = parts[0] || "";
    let desc = parts[1] || "";
    let price = parts[2] || "";
    if (!desc) {
      const m = name.match(/^(.+?)\s*[–—:]\s*(.+)$/);
      if (m) {
        name = m[1];
        desc = m[2];
      }
    }
    return { name: name.slice(0, 60), desc: desc.slice(0, 200), price: price.slice(0, 40) };
  });
}

const IMAGE_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Copy the base template into /opt/tenants/<userId>/<slug> and seed site.json from the brief. */
export function provisionWorkspace(userId: string, slug: string, brief: BriefInput): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId) || !/^[a-z0-9-]+$/.test(slug)) {
    throw new Error("Invalid userId or slug for workspace path");
  }
  const dest = path.join(TENANTS_ROOT, userId, slug);
  if (fs.existsSync(dest)) throw new Error("Workspace already exists");
  if (!fs.existsSync(TEMPLATE_DIR)) throw new Error("Template directory missing");

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execFileSync("cp", ["-r", TEMPLATE_DIR, dest]);

  const category = normalizeCategory(brief.category);
  const palette = CATEGORY_COLORS[brief.colors] || getCategory(category).palette;
  const siteJson = {
    slug,
    business_name: brief.business_name,
    tagline: "",
    category,
    phone: brief.phone || "0300 0000000",
    email: "",
    address: brief.address || "",
    hours: brief.hours || "",
    hero_image: "",
    hero_video: "",
    about_image: "",
    gallery: [] as string[],
    palette,
    services: servicesFromText(brief.services),
    about: brief.instructions || "",
    media_credits: [] as { name: string; url: string }[],
  };
  fs.writeFileSync(path.join(dest, "site.json"), JSON.stringify(siteJson, null, 2) + "\n");

  // The slug is used by the browser data layer to isolate each site's demo data.
  for (const file of fs.readdirSync(dest)) {
    if (!file.endsWith(".html")) continue;
    const p = path.join(dest, file);
    const html = fs.readFileSync(p, "utf8");
    if (html.includes("__SITE_SLUG__")) fs.writeFileSync(p, html.split("__SITE_SLUG__").join(slug));
  }

  if (brief.design_image && fs.existsSync(brief.design_image)) {
    const ext = IMAGE_EXT[brief.design_image_mime || ""] || "png";
    const designDir = path.join(dest, "design");
    fs.mkdirSync(designDir, { recursive: true });
    fs.copyFileSync(brief.design_image, path.join(designDir, `reference.${ext}`));
    fs.writeFileSync(
      path.join(designDir, "reference.json"),
      JSON.stringify({ notes: brief.design_notes || "", mime: brief.design_image_mime || "" }, null, 2) + "\n"
    );
  }
  return dest;
}

/** Remove a workspace (used for rollback / cleanup). */
export function removeWorkspace(userId: string, slug: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId) || !/^[a-z0-9-]+$/.test(slug)) {
    throw new Error("Invalid userId or slug for workspace path");
  }
  const dest = path.join(TENANTS_ROOT, userId, slug);
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
}

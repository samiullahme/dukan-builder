import { getCategory, normalizeCategory } from "./categories";

export type BriefData = {
  business_name: string;
  instructions: string;
  address: string;
  phone: string;
  hours: string;
  services: string;
  colors: string;
  category?: string;
  design_notes?: string;
  design_plan?: string;
};

const DELIM = "|||USER-BRIEF|||";

function designSection(brief: BriefData): string {
  let plan: any = null;
  if (brief.design_plan) {
    try {
      plan = JSON.parse(brief.design_plan);
    } catch {
      plan = null;
    }
  }
  const notes = brief.design_notes?.trim();
  if (!plan && !notes) {
    const cat = getCategory(brief.category);
    return `DESIGN DIRECTION: No reference image was uploaded. Choose ONE distinctive aesthetic that fits a ${cat.label.toLowerCase()} in Pakistan and commit to it fully. Define design tokens first: one brand colour plus neutrals, a serif/sans font pairing from Google Fonts, generous spacing. The page must not look like a generic template.`;
  }
  const lines = [
    "DESIGN REFERENCE (follow it faithfully): The owner uploaded a design reference and a vision model analyzed it. Mirror its layout, section structure, palette, typography and mood, while writing all copy from this business's real facts.",
    "Reproduce EVERY section the analysis lists, in the same order and the same kind: if it lists category chips, the homepage gets category chips; if it lists testimonial cards, include testimonial cards; if it lists a promo band, include one. Do not drop or replace sections.",
    "The palette in site.json is derived from the reference — treat it as fixed. Build every colour in styles.css from the --primary/--accent/--bg tokens (plus tints and shades of them), so the site reads as the reference's palette, not a generic one.",
    "Use the section descriptions below as structural instructions only. Never copy text from the reference or the analysis — every word of copy must come from the business facts.",
  ];
  if (plan?.design_prompt) lines.push(`Design brief: ${plan.design_prompt}`);
  if (plan?.layout_description) lines.push(`Layout: ${plan.layout_description}`);
  if (plan?.style) lines.push(`Style: ${plan.style}`);
  if (plan?.typography) lines.push(`Typography: ${plan.typography}`);
  if (Array.isArray(plan?.color_palette) && plan.color_palette.length) {
    lines.push(`Palette from the reference: ${plan.color_palette.join(", ")}`);
  }
  if (Array.isArray(plan?.sections) && plan.sections.length) {
    lines.push(
      "Sections in order:\n" +
        plan.sections
          .map((s: any, i: number) => `  ${i + 1}. ${s.name} — ${s.description || ""}`)
          .join("\n")
    );
  }
  if (notes) lines.push(`Owner notes about the reference: ${notes}`);
  return lines.join("\n");
}

export function renderBuildPrompt(brief: BriefData): string {
  const cat = getCategory(brief.category);
  return `You are customizing a production small-business website in this workspace.

AGENTS.md is loaded in your instructions and the design reference is summarized below. Work directly on the 3 editable files without extra reads.

The workspace already contains a COMPLETE, WORKING multi-page website:
index.html, about.html, services.html, gallery.html, contact.html, login.html, dashboard.html, admin.html
plus locked JavaScript that powers booking/inquiry forms, newsletter signup, customer login and dashboard, an owner admin dashboard with request management and CSV export, and a browser-local demo data store.

HARD RULES — violating any of these fails the build:
1. You may edit ONLY these three files: site.json, index.html, styles.css. Never create, edit, rename or delete any other file. Never add your own script files or inline JS that replaces theme.js, site.js, categories.js, store.js, forms.js, auth.js, dashboard.js or admin.js.
2. Every page must stay present and working. Keep all navigation links to about, services, gallery, contact, login, dashboard (including the [data-book-label] booking CTA) and admin. Keep every data-slot, data-slot-attr, data-slot-src and data-slot-href attribute. Keep #services-grid, #gallery-grid, #booking-form, #inquiry-form, #newsletter-form, the booking/inquiry success panels, and every script tag. Do not remove or rewire the login/dashboard/admin pages.
3. Do NOT change these site.json fields: slug, category, hero_image, hero_video, about_image, gallery, media_credits. They were fetched and verified before this build. Do not invent, replace or re-order image URLs and do not add images from other sources.
4. NEVER invent reviews, testimonials, ratings, awards, customer counts, years in business, certifications or prices. Use only the business facts below. No placeholder left-overs like "Your Business Name", "Service one" or lorem ipsum may remain in the final page.
5. The site category is "${normalizeCategory(brief.category)}" (${cat.label}). The booking form fields are generated from categories.js for this category — keep that category and do not change form field names.
6. Menu fidelity: copy every product/service name, description and price from the business facts EXACTLY as given. Do not rename dishes, do not round or invent prices, do not add items that are not listed, and do not reorder the list. Automated QA compares your services against the brief.

Business facts — use ONLY these, inside the delimiters:
${DELIM}
Name: ${brief.business_name}
Phone / WhatsApp: ${brief.phone || "(not provided)"}
Address: ${brief.address || "(not provided)"}
Hours: ${brief.hours || "(not provided)"}
Products / services (one per line; optional | price):
${brief.services || "(not provided)"}
About the business: ${brief.instructions || "(not provided)"}
Preferred colour direction: ${brief.colors || "choose what fits the design/business"}
${DELIM}

${designSection(brief)}

Your job:
1. site.json — keep the media fields exactly as they are. Write the real content: business_name, tagline, about (2–4 warm, specific sentences built only from the facts), phone, address, hours, and services[] as {name, desc, price}. Each services[] entry must reproduce the corresponding brief item verbatim — same name, same price (a price may only be filled when the owner provided one; otherwise use ""). Set the palette to the reference palette when one exists, adjusted for readable contrast.
2. index.html — polish the homepage into a distinctive, premium page for this business using the reference design direction. Reproduce every section from the design reference analysis in order and in kind (chips stay chips, cards stay cards, bands stay bands). Keep the structure and all slot/ID contracts. Include the hero, services, gallery (hidden if no images), about, and a clear call to action. Do not add fake testimonials or stats sections. Replace placeholder copy everywhere in index.html. Keep the <!-- chrome:header:start/end --> and <!-- chrome:footer:start/end --> markers around the header and footer, and keep both styles.css and pages.css linked — the builder copies this chrome into every other page, so it must work there (no homepage-only widgets, no bare #section links).
3. styles.css — rebuild the visual system to match the reference: design tokens, typography scale, layout, spacing, hero treatment, cards, gallery, responsive rules at 900px/640px. Derive all colours from the --primary/--accent/--bg tokens in site.json. Keep it readable, accessible, and mobile-first. No purple/blue gradients, no emoji icons, no three identical generic cards, no dark-on-dark text.
4. The locked pages (about, services, gallery, contact, login, dashboard, admin) reuse site.json through locked scripts and inherit styles.css/pages.css — they must keep working. The owner dashboard and customer dashboard are a mandatory part of every site; never break them.
5. NEVER start a web server, fetch URLs, install packages, or try to render the page. Automated QA runs after you with a real browser and will send back any problems. Work efficiently and spend your budget on the three files.

When finished, output a one-line summary. Do not read back the files; automated browser QA runs immediately after you.`;
}

export function renderRefinePrompt(brief: BriefData, userMessage: string): string {
  return `AGENTS.md is loaded in your instructions. The site already has a working multi-page structure and dashboards.

The site owner requests this change (inside delimiters — it applies to THIS workspace only):
${DELIM}
${userMessage}
${DELIM}

HARD RULES:
- Edit ONLY site.json, index.html and styles.css. All other files are locked and will be restored automatically if changed.
- Keep every data-slot / data-slot-attr / data-slot-src / data-slot-href attribute, every required ID, and every script tag. Keep all pages and the customer/owner dashboards working.
- The header and footer are shared chrome: keep the chrome:header and chrome:footer markers around them in index.html, keep pages.css linked, and do not put homepage-only widgets or bare #section links in them — they are copied into every other page.
- Do NOT change slug, category, hero_image, hero_video, about_image, gallery or media_credits in site.json. Do not invent images, reviews, ratings, awards or prices.
- Business context: "${brief.business_name}" (${getCategory(brief.category).label}).

Apply the change with taste and restraint. Do not read back the files; automated browser QA runs immediately after you. Reply with a one-line summary.`;
}

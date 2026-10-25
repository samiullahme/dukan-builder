import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import db, { tx } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { slugify, uniqueSlug } from "@/lib/site";
import { takeToken } from "@/lib/ratelimit";
import { normalizeCategory } from "@/lib/categories";
import { getPlatformSettings } from "@/lib/admin";
import { provisionWorkspace, removeWorkspace, type BriefInput } from "@/lib/provision";
import { ensureSiteCredential } from "@/lib/site-admin";

const UPLOADS_ROOT = process.env.UPLOADS_DIR || "/opt/builder/data/uploads";
const MAX_UPLOAD = 8 * 1024 * 1024;

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const sites = await db
    .prepare("SELECT id, slug, business_name, category, status, created_at FROM sites WHERE user_id = ? ORDER BY created_at DESC")
    .all(user.id);
  return NextResponse.json(sites);
}

function sniffImage(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: "png" };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: "image/jpeg", ext: "jpg" };
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!(await takeToken(`site-create:${user.id}`, 10, 10 / 3600))) {
    return NextResponse.json({ error: "Too many sites created. Try again later." }, { status: 429 });
  }

  const contentType = req.headers.get("content-type") || "";
  let raw: Record<string, unknown> = {};
  let designFile: File | null = null;
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return NextResponse.json({ error: "Could not read the submitted form." }, { status: 400 });
    }
    for (const [key, value] of form.entries()) {
      if (typeof value === "string") raw[key] = value;
    }
    const file = form.get("design");
    if (file && typeof file === "object" && "arrayBuffer" in file && file.size > 0) designFile = file as File;
  } else {
    raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  }

  const str = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
  const business_name = str(raw.business_name, 200);
  if (business_name.length < 2 || business_name.length > 80) {
    return NextResponse.json({ error: "Business name must be 2–80 characters." }, { status: 400 });
  }
  const category = normalizeCategory(raw.category);

  const settings = await getPlatformSettings();
  const haystack = `${business_name} ${str(raw.instructions, 4000)}`.toLowerCase();
  const banned = settings.banned_words.find((w) => w && haystack.includes(w.toLowerCase()));
  if (banned) {
    return NextResponse.json({ error: "The name or description contains a word that is not allowed." }, { status: 400 });
  }

  let design_image = "";
  let design_image_mime = "";
  if (designFile) {
    if (designFile.size > MAX_UPLOAD) {
      return NextResponse.json({ error: "The design image must be 8 MB or smaller." }, { status: 400 });
    }
    const buf = Buffer.from(await designFile.arrayBuffer());
    const sniffed = sniffImage(buf);
    if (!sniffed) {
      return NextResponse.json({ error: "Upload a PNG, JPEG or WebP image." }, { status: 400 });
    }
    try {
      fs.mkdirSync(UPLOADS_ROOT, { recursive: true, mode: 0o750 });
      const name = `${crypto.randomUUID()}.${sniffed.ext}`;
      const dest = path.join(UPLOADS_ROOT, name);
      fs.writeFileSync(dest, buf, { mode: 0o640 });
      design_image = dest;
      design_image_mime = sniffed.mime;
    } catch (e: any) {
      console.error("upload save failed:", e?.message);
      return NextResponse.json({ error: "Could not save the uploaded image." }, { status: 500 });
    }
  }

  const brief: BriefInput = {
    business_name,
    instructions: str(raw.instructions, 4000),
    address: str(raw.address, 160),
    phone: str(raw.phone, 40),
    hours: str(raw.hours, 120),
    services: str(raw.services, 2000),
    colors: str(raw.colors, 80),
    category,
    design_image,
    design_image_mime,
    design_notes: str(raw.design_notes, 1000),
  };

  const id = crypto.randomUUID();
  const slug = await uniqueSlug(slugify(business_name));

  // Provision the on-disk workspace first; roll back the DB row if it fails.
  try {
    provisionWorkspace(user.id, slug, brief);
  } catch (e: any) {
    console.error("provision failed:", e?.message);
    if (design_image) fs.rmSync(design_image, { force: true });
    return NextResponse.json({ error: "Could not set up the site workspace. Please try again." }, { status: 500 });
  }

  try {
    await tx(async (t) => {
      await t
        .prepare("INSERT INTO sites (id, user_id, slug, business_name, category, status) VALUES (?,?,?,?,?,?)")
        .run(id, user.id, slug, business_name, category, "draft");
      await t
        .prepare(
          `INSERT INTO briefs (id, site_id, instructions, address, phone, hours, services, colors, category, design_image, design_image_mime, design_notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          crypto.randomUUID(), id,
          brief.instructions, brief.address, brief.phone,
          brief.hours, brief.services, brief.colors,
          category, design_image, design_image_mime, brief.design_notes || ""
        );
    });
  } catch (e: any) {
    try { removeWorkspace(user.id, slug); } catch { /* best effort */ }
    if (design_image) fs.rmSync(design_image, { force: true });
    console.error("site insert failed:", e?.message);
    return NextResponse.json({ error: "Could not save the site. Please try again." }, { status: 500 });
  }

  try {
    await ensureSiteCredential(id, slug);
  } catch (e: any) {
    console.error("credential generation failed:", e?.message);
  }

  return NextResponse.json({ ok: true, id, slug, category, has_design: !!design_image }, { status: 201 });
}

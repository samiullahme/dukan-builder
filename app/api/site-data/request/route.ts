import { NextResponse } from "next/server";
import db from "@/lib/db";
import { takeToken } from "@/lib/ratelimit";
import {
  clientIp,
  isEmail,
  makeRef,
  siteIdBySlug,
  toRequestJson,
  REQUEST_TYPES,
} from "@/lib/site-data";

/** Public: a visitor submits a booking or enquiry. Stored per site so the
 *  owner dashboard shows it on any device. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const slug = String(body.slug || "").trim().toLowerCase();
  const type = String(body.type || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim().slice(0, 120);
  const phone = String(body.phone || "").trim().slice(0, 40);
  const message = String(body.message || "").trim().slice(0, 1200);
  const rawFields = body.fields && typeof body.fields === "object" ? (body.fields as Record<string, unknown>) : {};

  if (!slug || !type || !name || !isEmail(email)) {
    return NextResponse.json({ error: "Please check your details and try again." }, { status: 400 });
  }
  if (!(REQUEST_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: "Unknown request type." }, { status: 400 });
  }

  const ip = clientIp(req);
  if (!(await takeToken(`site-submit:${ip}`, 30, 30 / 3600))) {
    return NextResponse.json({ error: "Too many submissions. Try again later." }, { status: 429 });
  }

  const siteId = await siteIdBySlug(slug);
  if (!siteId) {
    return NextResponse.json({ error: "This site does not accept submissions." }, { status: 404 });
  }

  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawFields)) {
    if (value == null) continue;
    fields[String(key).slice(0, 50)] = String(value).slice(0, 500);
  }

  let ref = String(body.ref || "").trim();
  if (!/^[A-Za-z]{2,3}-[A-Za-z0-9-]{1,24}$/.test(ref)) ref = makeRef(type);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const id = crypto.randomUUID();
      await db
        .prepare(
          `INSERT INTO site_requests (id, site_id, ref, type, status, name, email, phone, message, fields, sample, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?::jsonb,?,?)`
        )
        .run(id, siteId, ref, type, "new", name, email, phone, message, JSON.stringify(fields), false, new Date().toISOString());
      return NextResponse.json({
        ok: true,
        request: { id, ref, type, status: "new", name, email, phone, message, fields, sample: false, createdAt: new Date().toISOString() },
      });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === "23505" && attempt < 2) {
        ref = makeRef(type);
        continue;
      }
      return NextResponse.json({ error: "The submission could not be saved. Please try again." }, { status: 500 });
    }
  }
  return NextResponse.json({ error: "The submission could not be saved. Please try again." }, { status: 500 });
}

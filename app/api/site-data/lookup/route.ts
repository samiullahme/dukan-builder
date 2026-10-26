import { NextResponse } from "next/server";
import db from "../../../../lib/db";
import { takeToken } from "../../../../lib/ratelimit";
import { clientIp, isEmail, iso, siteIdBySlug, type SiteRequestRow } from "../../../../lib/site-data";

/** Public: a visitor looks up their bookings/enquiries by email + ref list.
 *  Returns only non-sensitive tracking fields (ref, type, status, createdAt, fields). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const slug = String(body.slug || "").trim().toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  const rawRefs = Array.isArray(body.refs) ? body.refs : [];
  const refs = Array.from(
    new Set(rawRefs.map((r: unknown) => String(r || "").trim()).filter((r: string) => /^[A-Za-z]{2,3}-[A-Za-z0-9-]{1,24}$/.test(r)))
  ).slice(0, 20);

  if (!slug || !isEmail(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  const ip = clientIp(req);
  if (!(await takeToken(`site-lookup:${ip}`, 10, 10 / 3600))) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  if (refs.length === 0) {
    return NextResponse.json({ ok: true, requests: [] });
  }

  const siteId = await siteIdBySlug(slug);
  if (!siteId) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const placeholders = refs.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT id, ref, type, status, created_at, fields FROM site_requests WHERE site_id = ? AND email = ? AND ref IN (${placeholders}) AND sample = false`
    )
    .all<Pick<SiteRequestRow, "id" | "ref" | "type" | "status" | "created_at" | "fields">>(siteId, email, ...refs);

  const requests = rows.map((r) => ({
    id: r.id,
    ref: r.ref,
    type: r.type,
    status: r.status,
    createdAt: iso(r.created_at),
    fields: typeof r.fields === "string" ? JSON.parse(r.fields) : (r.fields ?? {}),
  }));

  return NextResponse.json({ ok: true, requests });
}

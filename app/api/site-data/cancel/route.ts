import { NextResponse } from "next/server";
import db from "@/lib/db";
import { takeToken } from "@/lib/ratelimit";
import { clientIp, isEmail, siteIdBySlug } from "@/lib/site-data";

/** Public: a visitor cancels their own booking/enquiry (ref + email must match). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const slug = String(body.slug || "").trim().toLowerCase();
  const ref = String(body.ref || "").trim();
  const email = String(body.email || "").trim().toLowerCase();

  if (!slug || !ref || !isEmail(email)) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const ip = clientIp(req);
  if (!(await takeToken(`site-cancel:${ip}`, 10, 10 / 3600))) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
  }

  const siteId = await siteIdBySlug(slug);
  if (!siteId) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }

  const row = await db
    .prepare("SELECT id, email, status FROM site_requests WHERE site_id = ? AND ref = ?")
    .get<{ id: string; email: string; status: string }>(siteId, ref);
  if (!row || row.email !== email) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  if (row.status !== "new" && row.status !== "confirmed") {
    return NextResponse.json({ error: "This request can no longer be cancelled." }, { status: 409 });
  }

  await db
    .prepare("UPDATE site_requests SET status = 'cancelled' WHERE id = ? AND site_id = ?")
    .run(row.id, siteId);
  return NextResponse.json({ ok: true });
}

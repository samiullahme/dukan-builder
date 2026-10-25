import { NextResponse } from "next/server";
import db from "@/lib/db";
import { takeToken } from "@/lib/ratelimit";
import { clientIp, isEmail, siteIdBySlug, toSubscriberJson, ownerFrom } from "@/lib/site-data";

/** Public: newsletter sign-up, deduplicated per site. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const slug = String(body.slug || "").trim().toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim().slice(0, 120);

  if (!slug || !isEmail(email)) {
    return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
  }

  const ip = clientIp(req);
  if (!(await takeToken(`site-submit:${ip}`, 30, 30 / 3600))) {
    return NextResponse.json({ error: "Too many submissions. Try again later." }, { status: 429 });
  }

  const siteId = await siteIdBySlug(slug);
  if (!siteId) {
    return NextResponse.json({ error: "This site does not accept subscriptions." }, { status: 404 });
  }

  const id = crypto.randomUUID();
  const inserted = await db
    .prepare(
      `INSERT INTO site_subscribers (id, site_id, email, name, sample, created_at)
       VALUES (?,?,?,?,?,?) ON CONFLICT (site_id, email) DO NOTHING`
    )
    .run(id, siteId, email, name, false, new Date().toISOString());

  if (!inserted.changes) {
    return NextResponse.json({ error: "That email is already subscribed." }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    subscriber: { id, email, name, sample: false, createdAt: new Date().toISOString() },
  });
}

/** Owner: remove a subscriber. */
export async function DELETE(req: Request) {
  const owner = await ownerFrom(req);
  if (!owner) {
    return NextResponse.json({ error: "Owner access required." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Subscriber id is required." }, { status: 400 });
  }
  await db.prepare("DELETE FROM site_subscribers WHERE id = ? AND site_id = ?").run(id, owner.site_id);
  return NextResponse.json({ ok: true });
}

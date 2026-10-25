import { NextResponse } from "next/server";
import db from "@/lib/db";
import {
  ALLOWED_STATUS,
  ownerFrom,
  seedSamplesIfNeeded,
  toRequestJson,
  toSubscriberJson,
  SiteRequestRow,
  SiteSubscriberRow,
} from "@/lib/site-data";

const MAX_ROWS = 500;

/** Owner: everything submitted to this site. */
export async function GET(req: Request) {
  const owner = await ownerFrom(req);
  if (!owner) {
    return NextResponse.json({ error: "Owner access required." }, { status: 401 });
  }
  await seedSamplesIfNeeded(owner.site_id);

  const requestRows = await db
    .prepare(`SELECT * FROM site_requests WHERE site_id = ? ORDER BY created_at DESC LIMIT ${MAX_ROWS}`)
    .all<SiteRequestRow>(owner.site_id);
  const subscriberRows = await db
    .prepare(`SELECT * FROM site_subscribers WHERE site_id = ? ORDER BY created_at DESC LIMIT ${MAX_ROWS}`)
    .all<SiteSubscriberRow>(owner.site_id);

  return NextResponse.json({
    ok: true,
    requests: requestRows.map(toRequestJson),
    subscribers: subscriberRows.map(toSubscriberJson),
  });
}

/** Owner: change a request's status (allowed transitions per type). */
export async function PATCH(req: Request) {
  const owner = await ownerFrom(req);
  if (!owner) {
    return NextResponse.json({ error: "Owner access required." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id || "").trim();
  const status = String(body.status || "").trim();
  if (!id || !status) {
    return NextResponse.json({ error: "Request id and status are required." }, { status: 400 });
  }

  const row = await db
    .prepare("SELECT type, status FROM site_requests WHERE id = ? AND site_id = ?")
    .get<{ type: string; status: string }>(id, owner.site_id);
  if (!row) {
    return NextResponse.json({ error: "Request not found." }, { status: 404 });
  }
  const allowed = ALLOWED_STATUS[row.type] || [];
  if (!allowed.includes(status)) {
    return NextResponse.json({ error: "That status is not allowed." }, { status: 400 });
  }

  await db
    .prepare("UPDATE site_requests SET status = ? WHERE id = ? AND site_id = ?")
    .run(status, id, owner.site_id);
  return NextResponse.json({ ok: true });
}

/** Owner: remove a request entirely. */
export async function DELETE(req: Request) {
  const owner = await ownerFrom(req);
  if (!owner) {
    return NextResponse.json({ error: "Owner access required." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "Request id is required." }, { status: 400 });
  }
  await db.prepare("DELETE FROM site_requests WHERE id = ? AND site_id = ?").run(id, owner.site_id);
  return NextResponse.json({ ok: true });
}

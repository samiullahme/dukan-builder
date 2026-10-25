import { NextResponse } from "next/server";
import db from "@/lib/db";
import { ownerFrom } from "@/lib/site-data";

/** Owner: remove the seeded sample rows. Real submissions are kept. */
export async function POST(req: Request) {
  const owner = await ownerFrom(req);
  if (!owner) {
    return NextResponse.json({ error: "Owner access required." }, { status: 401 });
  }
  await db.prepare("DELETE FROM site_requests WHERE site_id = ? AND sample = true").run(owner.site_id);
  await db.prepare("DELETE FROM site_subscribers WHERE site_id = ? AND sample = true").run(owner.site_id);
  return NextResponse.json({ ok: true });
}

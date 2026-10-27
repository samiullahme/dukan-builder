import { NextResponse } from "next/server";
import crypto from "crypto";
import db, { tx } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getSiteForUser } from "@/lib/site";
import { takeToken } from "@/lib/ratelimit";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const site = await getSiteForUser(id, user.id);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
  const messages = await db
    .prepare(`SELECT role, content, created_at FROM chat_messages WHERE site_id = ? ORDER BY created_at ASC LIMIT 100`)
    .all(site.id);
  const activeRefine = await db
    .prepare(`SELECT id FROM builds WHERE site_id = ? AND kind = 'refine' AND status IN ('queued','building') LIMIT 1`)
    .get(site.id);
  return NextResponse.json({ messages, refining: !!activeRefine });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const site = await getSiteForUser(id, user.id);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
  if (site.status !== "ready" && site.status !== "published") {
    return NextResponse.json({ error: "Chat unlocks after the first build finishes." }, { status: 409 });
  }
  if (!(await takeToken(`chat:${user.id}`, 20, 20 / 3600))) {
    return NextResponse.json({ error: "Too many messages. Try again later." }, { status: 429 });
  }

  const { message } = (await req.json().catch(() => ({}))) as any;
  const text = String(message ?? "").trim();
  if (text.length < 2 || text.length > 2000) {
    return NextResponse.json({ error: "Message must be 2–2000 characters." }, { status: 400 });
  }

  const busy = await db
    .prepare(`SELECT 1 FROM builds WHERE site_id = ? AND status IN ('pending','queued','building')`)
    .get(site.id);
  if (busy) return NextResponse.json({ error: "The AI is still working — wait for it to finish." }, { status: 409 });

  const buildId = crypto.randomUUID();
  await tx(async (t) => {
    await t.prepare(`INSERT INTO chat_messages (id, site_id, role, content) VALUES (?,?,?,?)`).run(
      crypto.randomUUID(), site.id, "user", text
    );
    await t.prepare(`INSERT INTO builds (id, site_id, kind, input, status) VALUES (?,?,?,?,?)`).run(
      buildId, site.id, "refine", text, "pending"
    );
  });

  return NextResponse.json({ ok: true, buildId }, { status: 201 });
}

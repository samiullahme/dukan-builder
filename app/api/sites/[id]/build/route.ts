import { NextResponse } from "next/server";
import crypto from "crypto";
import db from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getSiteForUser } from "@/lib/site";
import { takeToken } from "@/lib/ratelimit";
import { getPlatformSettings } from "@/lib/admin";

/** Enqueue an AI build for a site. The build worker (Phase 3) picks up `queued` rows. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const site = await getSiteForUser(id, user.id);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  if (!(await takeToken(`build-create:${user.id}`, 5, 5 / 3600))) {
    return NextResponse.json({ error: "Too many build requests. Try again later." }, { status: 429 });
  }

  const settings = await getPlatformSettings();
  if (!settings.feature_beta_builds) {
    return NextResponse.json({ error: "Beta builds are paused right now. Check back soon." }, { status: 403 });
  }

  const active = await db
    .prepare("SELECT 1 FROM builds WHERE site_id = ? AND status IN ('queued','building')")
    .get(site.id);
  if (active) return NextResponse.json({ error: "A build is already queued or running for this site." }, { status: 409 });

  const quota = (await db.prepare("SELECT builds_used, builds_allowed FROM quota WHERE user_id = ?").get(user.id)) as any;
  if ((quota?.builds_used ?? 0) >= (quota?.builds_allowed ?? settings.default_builds_allowed)) {
    return NextResponse.json({ error: "You have used all your beta builds." }, { status: 402 });
  }

  const buildId = crypto.randomUUID();
  await db.prepare("INSERT INTO builds (id, site_id, status) VALUES (?,?,?)").run(buildId, site.id, "queued");
  await db.prepare("UPDATE sites SET status = 'building' WHERE id = ?").run(site.id);

  return NextResponse.json({ ok: true, buildId }, { status: 201 });
}

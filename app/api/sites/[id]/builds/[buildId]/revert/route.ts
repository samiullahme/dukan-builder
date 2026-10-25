import { NextResponse } from "next/server";
import crypto from "crypto";
import db from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getSiteForUser } from "@/lib/site";
import { hasSnapshot } from "@/lib/history";

const TENANTS_ROOT = process.env.TENANTS_ROOT || "/opt/tenants";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; buildId: string }> }
) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id, buildId } = await params;
  const site = await getSiteForUser(id, user.id);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  const build = await db
    .prepare("SELECT id, kind, status FROM builds WHERE id = ? AND site_id = ?")
    .get<{ id: string; kind: string; status: string }>(buildId, site.id);
  if (!build) return NextResponse.json({ error: "Build not found." }, { status: 404 });
  if (build.kind !== "build" && build.kind !== "refine") {
    return NextResponse.json({ error: "Only built versions can be restored." }, { status: 400 });
  }
  if (build.status !== "ready") {
    return NextResponse.json({ error: "That build never finished successfully." }, { status: 409 });
  }
  const active = await db
    .prepare("SELECT 1 FROM builds WHERE site_id = ? AND status IN ('queued','building')")
    .get(site.id);
  if (active) {
    return NextResponse.json({ error: "Another build is running — wait for it to finish." }, { status: 409 });
  }

  const workspace = `${TENANTS_ROOT}/${site.user_id}/${site.slug}`;
  if (!hasSnapshot(workspace, buildId)) {
    return NextResponse.json(
      { error: "This version was built before version saving was added and cannot be restored." },
      { status: 409 }
    );
  }

  const revertId = crypto.randomUUID();
  await db
    .prepare("INSERT INTO builds (id, site_id, status, kind, input) VALUES (?, ?, 'queued', 'revert', ?)")
    .run(revertId, site.id, buildId);
  return NextResponse.json({ ok: true, buildId: revertId });
}

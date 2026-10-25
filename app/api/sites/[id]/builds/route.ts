import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getSiteForUser } from "@/lib/site";
import { hasSnapshot } from "@/lib/history";

const TENANTS_ROOT = process.env.TENANTS_ROOT || "/opt/tenants";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const site = await getSiteForUser(id, user.id);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
  const builds = await db
    .prepare("SELECT id, kind, status, log, started_at, finished_at, created_at FROM builds WHERE site_id = ? ORDER BY created_at DESC LIMIT 20")
    .all<any>(site.id);
  const workspace = `${TENANTS_ROOT}/${site.user_id}/${site.slug}`;
  return NextResponse.json(
    builds.map((b) => ({
      ...b,
      revertable:
        (b.kind === "build" || b.kind === "refine") &&
        b.status === "ready" &&
        hasSnapshot(workspace, b.id),
    }))
  );
}

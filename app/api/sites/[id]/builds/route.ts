import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getSiteForUser } from "@/lib/site";
import { hasSnapshot } from "@/lib/history";
import { deriveBuildProgress, extractAdminTechnicalSummary } from "@/lib/failures";

const TENANTS_ROOT = process.env.TENANTS_ROOT || "/opt/tenants";

function parseDbTime(value: string | null): number {
  return value ? Date.parse(value.replace(" ", "T") + "Z") : NaN;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const site = await getSiteForUser(id, user.id);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
  const builds = await db
    .prepare("SELECT id, kind, status, log, started_at, finished_at, created_at FROM builds WHERE site_id = ? ORDER BY created_at DESC LIMIT 20")
    .all<{
      id: string;
      kind: string;
      status: string;
      log: string;
      started_at: string | null;
      finished_at: string | null;
      created_at: string;
    }>(site.id);
  const workspace = `${TENANTS_ROOT}/${site.user_id}/${site.slug}`;
  const isAdmin = user.is_admin === 1;
  return NextResponse.json(
    builds.map((b) => {
      const fromMs = parseDbTime(b.started_at || b.created_at);
      const toMs = b.finished_at ? parseDbTime(b.finished_at) : Date.now();
      const elapsedSeconds =
        Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs >= fromMs
          ? Math.floor((toMs - fromMs) / 1000)
          : 0;
      const progress = deriveBuildProgress(b.status, b.log || "", elapsedSeconds);
      return {
        id: b.id,
        kind: b.kind,
        status: b.status,
        started_at: b.started_at,
        finished_at: b.finished_at,
        created_at: b.created_at,
        progress,
        log: isAdmin ? b.log : "",
        technical: isAdmin ? extractAdminTechnicalSummary(b.log || "") : undefined,
        revertable:
          (b.kind === "build" || b.kind === "refine") &&
          b.status === "ready" &&
          hasSnapshot(workspace, b.id),
      };
    })
  );
}

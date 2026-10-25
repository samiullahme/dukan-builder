import { NextResponse } from "next/server";
import db from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getSiteForUser } from "@/lib/site";
import { publishWorkspace } from "@/lib/publish";

const TENANTS_ROOT = process.env.TENANTS_ROOT || "/opt/tenants";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const site = await getSiteForUser(id, user.id);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
  if (site.status !== "ready" && site.status !== "published") {
    return NextResponse.json({ error: "Build the site before publishing it." }, { status: 409 });
  }

  try {
    const workspace = `${TENANTS_ROOT}/${site.user_id}/${site.slug}`;
    publishWorkspace(workspace, site.slug);
  } catch (e: any) {
    return NextResponse.json({ error: "Publish failed: " + e.message }, { status: 500 });
  }

  await db.prepare(`UPDATE sites SET status = 'published' WHERE id = ?`).run(site.id);
  return NextResponse.json({ ok: true, url: `https://${site.slug}.dukanbot.website` });
}

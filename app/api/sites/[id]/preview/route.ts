import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getUser } from "@/lib/auth";
import { getSiteForUser } from "@/lib/site";
import { execFileSync } from "child_process";

const TENANTS_ROOT = process.env.TENANTS_ROOT || "/opt/tenants";
// Caddy's /opt/preview-current (root-owned) points at this builder-owned link,
// so the app can retarget it without root.
const PREVIEW_LINK = process.env.PREVIEW_LINK || "/opt/preview/current";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const site = await getSiteForUser(id, user.id);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
  if (site.status !== "ready" && site.status !== "published") {
    return NextResponse.json({ error: "Build the site before previewing it." }, { status: 409 });
  }

  const workspace = path.join(TENANTS_ROOT, site.user_id, site.slug);
  if (!fs.existsSync(path.join(workspace, "index.html"))) {
    return NextResponse.json({ error: "Workspace files are missing." }, { status: 500 });
  }

  try {
    // Update the builder-owned symlink that Caddy's /opt/preview-current follows.
    fs.mkdirSync(path.dirname(PREVIEW_LINK), { recursive: true });
    execFileSync("ln", ["-sfn", workspace, PREVIEW_LINK]);
    fs.chmodSync(workspace, 0o755);
  } catch (e: any) {
    return NextResponse.json({ error: "Could not start the preview: " + e.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

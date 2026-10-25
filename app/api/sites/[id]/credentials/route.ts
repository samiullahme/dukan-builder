import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { writeAudit } from "@/lib/admin";
import { getSiteForUser } from "@/lib/site";
import { isCredentialsUnlocked, readSiteCredential, rotateSiteCredential } from "@/lib/site-admin";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const site = await getSiteForUser(id, user.id);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
  if (!(await isCredentialsUnlocked(user.id))) {
    return NextResponse.json({ error: "locked", code: "totp_required" }, { status: 403 });
  }
  const cred = await readSiteCredential(site.id);
  if (!cred) return NextResponse.json({ error: "No owner credentials for this site yet." }, { status: 404 });
  await writeAudit(user, "credentials_viewed", "site", site.id, null, null);
  return NextResponse.json(cred);
}

export async function POST(req: Request, { params }: Ctx) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const site = await getSiteForUser(id, user.id);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });
  if (!(await isCredentialsUnlocked(user.id))) {
    return NextResponse.json({ error: "locked", code: "totp_required" }, { status: 403 });
  }
  const cred = await rotateSiteCredential(site.id);
  await writeAudit(user, "password_rotated", "site", site.id, null, null);
  return NextResponse.json(cred);
}

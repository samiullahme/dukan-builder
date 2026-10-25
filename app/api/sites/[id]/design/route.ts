import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import db from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getSiteForUser } from "@/lib/site";

const UPLOADS_ROOT = process.env.UPLOADS_DIR || "/opt/builder/data/uploads";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const site = await getSiteForUser(id, user.id);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  const brief = (await db.prepare("SELECT design_image, design_image_mime FROM briefs WHERE site_id = ?").get(site.id)) as
    | { design_image: string; design_image_mime: string }
    | undefined;
  if (!brief?.design_image) return NextResponse.json({ error: "No design reference." }, { status: 404 });

  const resolved = path.resolve(brief.design_image);
  if (!resolved.startsWith(path.resolve(UPLOADS_ROOT) + path.sep)) {
    return NextResponse.json({ error: "Invalid design path." }, { status: 404 });
  }
  let data: Buffer;
  try {
    data = fs.readFileSync(resolved);
  } catch {
    return NextResponse.json({ error: "Design reference is missing." }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": brief.design_image_mime || "application/octet-stream",
      "Content-Length": String(data.length),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { getUser } from "@/lib/auth";
import { getSiteForUser } from "@/lib/site";

const execFileAsync = promisify(execFile);
const TENANTS_ROOT = process.env.TENANTS_ROOT || "/opt/tenants";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { id } = await params;
  const site = await getSiteForUser(id, user.id);
  if (!site) return NextResponse.json({ error: "Site not found." }, { status: 404 });

  const workspace = path.join(TENANTS_ROOT, site.user_id, site.slug);
  if (!fs.existsSync(path.join(workspace, "index.html"))) {
    return NextResponse.json({ error: "Workspace files are missing." }, { status: 404 });
  }

  const tmpZip = path.join(os.tmpdir(), `dukan-${site.slug}-${crypto.randomBytes(6).toString("hex")}.zip`);
  try {
    // Zip the workspace source, leaving out platform-only files.
    await execFileAsync(
      "zip",
      ["-qr", tmpZip, ".", "-x", "opencode.json", "-x", "AGENTS.md", "-x", "design/*", "-x", "design", "-x", ".history/*", "-x", ".history"],
      { cwd: workspace }
    );
    const data = await fs.promises.readFile(tmpZip);
    await fs.promises.unlink(tmpZip).catch(() => {});
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${site.slug}.zip"`,
        "Content-Length": String(data.length),
      },
    });
  } catch (e: any) {
    await fs.promises.unlink(tmpZip).catch(() => {});
    return NextResponse.json({ error: "Could not create the ZIP: " + e.message }, { status: 500 });
  }
}

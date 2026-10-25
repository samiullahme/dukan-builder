import fs from "fs";
import path from "path";
import crypto from "crypto";

const PUBLISHED_ROOT = process.env.PUBLISHED_ROOT || "/opt/www/published";
const PUBLISH_DROPS = ["opencode.json", "AGENTS.md", "design", ".history"];

/** Copy a workspace into the published root with an atomic staging swap.
 * Returns the final published directory. */
export function publishWorkspace(workspace: string, slug: string): string {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("invalid site slug");
  if (!fs.existsSync(path.join(workspace, "index.html"))) {
    throw new Error("workspace files are missing");
  }
  const staging = path.join(PUBLISHED_ROOT, `.tmp-${slug}-${crypto.randomBytes(6).toString("hex")}`);
  const target = path.join(PUBLISHED_ROOT, slug);
  try {
    fs.mkdirSync(PUBLISHED_ROOT, { recursive: true });
    fs.cpSync(workspace, staging, { recursive: true });
    for (const drop of PUBLISH_DROPS) {
      fs.rmSync(path.join(staging, drop), { recursive: true, force: true });
    }
    // Published files must be world-readable: Caddy serves them as the `caddy` user.
    // Directories need the execute bit too, or subdirectories like media/ 403.
    const chmodTree = (p: string) => {
      if (fs.statSync(p).isDirectory()) {
        fs.chmodSync(p, 0o755);
        for (const f of fs.readdirSync(p)) chmodTree(path.join(p, f));
      } else {
        fs.chmodSync(p, 0o644);
      }
    };
    chmodTree(staging);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
  } catch (e: any) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw e;
  }
  return target;
}

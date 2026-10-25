import fs from "fs";
import path from "path";
import crypto from "crypto";
import { chmodRecursive, copyWorkspaceNoSymlinks, sanitizeWorkspace } from "./workspace-security";

const DEFAULT_PUBLISHED_ROOT = "/opt/www/published";
export const PUBLISH_DROPS = ["opencode.json", "AGENTS.md", "design", ".history"] as const;

/** Copy a workspace into the published root with an atomic staging swap.
 * Returns the final published directory. */
export function publishWorkspace(
  workspace: string,
  slug: string,
  publishedRoot = process.env.PUBLISHED_ROOT || DEFAULT_PUBLISHED_ROOT
): string {
  if (!/^[a-z0-9-]+$/.test(slug)) throw new Error("invalid site slug");
  sanitizeWorkspace(workspace);
  if (!fs.existsSync(path.join(workspace, "index.html"))) {
    throw new Error("workspace files are missing");
  }
  const staging = path.join(publishedRoot, `.tmp-${slug}-${crypto.randomBytes(6).toString("hex")}`);
  const target = path.join(publishedRoot, slug);
  try {
    fs.mkdirSync(publishedRoot, { recursive: true });
    copyWorkspaceNoSymlinks(workspace, staging);
    for (const drop of PUBLISH_DROPS) {
      fs.rmSync(path.join(staging, drop), { recursive: true, force: true });
    }
    // Published files must be world-readable: Caddy serves them as the `caddy` user.
    // Directories need the execute bit too, or subdirectories like media/ 403.
    chmodRecursive(staging);
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(staging, target);
  } catch (e: any) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw e;
  }
  return target;
}

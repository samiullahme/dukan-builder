import fs from "fs";
import path from "path";
import { syncChrome } from "./chrome";

/**
 * Per-build snapshots of the agent-editable files, stored inside the tenant
 * workspace so a site can be restored to any recent build with one click.
 * Locked pages and media are intentionally excluded: locked pages are
 * re-derived from index.html by syncChrome(), and media files stay untouched
 * (the restored site.json keeps pointing at the current localized files).
 */
const HISTORY_DIR = ".history";
const SNAPSHOT_FILES = ["index.html", "styles.css", "site.json"];
const KEEP_SNAPSHOTS = 20;

export function historyDir(workspace: string): string {
  return path.join(workspace, HISTORY_DIR);
}

export function hasSnapshot(workspace: string, buildId: string): boolean {
  if (!/^[a-z0-9-]+$/i.test(buildId)) return false;
  return fs.existsSync(path.join(historyDir(workspace), buildId, "index.html"));
}

export function snapshotBuild(workspace: string, buildId: string): boolean {
  if (!/^[a-z0-9-]+$/i.test(buildId)) return false;
  const dir = path.join(historyDir(workspace), buildId);
  try {
    fs.mkdirSync(dir, { recursive: true });
    let ok = true;
    for (const f of SNAPSHOT_FILES) {
      const src = path.join(workspace, f);
      if (!fs.existsSync(src)) {
        ok = false;
        continue;
      }
      fs.copyFileSync(src, path.join(dir, f));
    }
    fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify({ savedAt: new Date().toISOString() }) + "\n");
    return ok;
  } catch {
    return false;
  }
}

/** Restore the editable files from a snapshot and re-sync the shared chrome
 * into the locked pages. Returns false when the snapshot is missing. */
export function restoreSnapshot(workspace: string, buildId: string): boolean {
  const dir = path.join(historyDir(workspace), buildId);
  if (!fs.existsSync(path.join(dir, "index.html"))) return false;
  for (const f of SNAPSHOT_FILES) {
    const src = path.join(dir, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(workspace, f));
  }
  syncChrome(workspace);
  return true;
}

export function pruneHistory(workspace: string, keep: number = KEEP_SNAPSHOTS): number {
  const root = historyDir(workspace);
  if (!fs.existsSync(root)) return 0;
  const dirs = fs
    .readdirSync(root)
    .filter((d) => /^[a-z0-9-]+$/i.test(d))
    .map((d) => {
      let m = 0;
      try {
        m = fs.statSync(path.join(root, d)).mtimeMs;
      } catch {
        // ignore
      }
      return { d, m };
    })
    .sort((a, b) => b.m - a.m);
  let removed = 0;
  for (const { d } of dirs.slice(keep)) {
    fs.rmSync(path.join(root, d), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

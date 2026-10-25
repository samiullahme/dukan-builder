import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodRecursive, copyWorkspaceNoSymlinks, sanitizeWorkspace } from "../lib/workspace-security";
import { publishWorkspace } from "../lib/publish";

vi.mock("../lib/db", () => ({
  get: vi.fn(),
  query: vi.fn(),
  run: vi.fn(),
}));

vi.mock("../lib/admin", () => ({
  writeAudit: vi.fn(),
}));

import { get, run } from "../lib/db";
import { republishSite } from "../lib/admin-actions";

const temporaryRoots: string[] = [];
const originalTenantsRoot = process.env.TENANTS_ROOT;
const originalPublishedRoot = process.env.PUBLISHED_ROOT;

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dukan-workspace-security-"));
  temporaryRoots.push(dir);
  return dir;
}

afterEach(() => {
  if (originalTenantsRoot === undefined) delete process.env.TENANTS_ROOT;
  else process.env.TENANTS_ROOT = originalTenantsRoot;
  if (originalPublishedRoot === undefined) delete process.env.PUBLISHED_ROOT;
  else process.env.PUBLISHED_ROOT = originalPublishedRoot;
  for (const dir of temporaryRoots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("workspace symlink safety", () => {
  it("removes file and directory symlinks without touching their targets", () => {
    const workspace = makeTempDir();
    const fileLink = path.join(workspace, "hostname-link");
    const directoryLink = path.join(workspace, "etc-link");
    fs.symlinkSync("/etc/hostname", fileLink);
    fs.symlinkSync("/etc", directoryLink, "dir");

    expect(sanitizeWorkspace(workspace)).toBe(2);
    expect(fs.existsSync(fileLink)).toBe(false);
    expect(fs.existsSync(directoryLink)).toBe(false);
    expect(fs.existsSync("/etc/hostname")).toBe(true);
  });

  it("refuses to copy a symlink and never chmods a symlink target", () => {
    const workspace = makeTempDir();
    const destination = path.join(makeTempDir(), "copy");
    const fileLink = path.join(workspace, "hostname-link");
    fs.symlinkSync("/etc/hostname", fileLink);
    const modeBefore = fs.statSync("/etc/hostname").mode & 0o777;

    expect(() => copyWorkspaceNoSymlinks(workspace, destination)).toThrow(/symlink/);
    chmodRecursive(fileLink);

    expect(fs.statSync("/etc/hostname").mode & 0o777).toBe(modeBefore);
    expect(fs.existsSync(path.join(destination, "hostname-link"))).toBe(false);
  });

  it("does not publish .history, opencode.json, AGENTS.md, or design via publishWorkspace or republishSite", async () => {
    const tenantsRoot = makeTempDir();
    const publishedRoot = makeTempDir();
    process.env.TENANTS_ROOT = tenantsRoot;
    process.env.PUBLISHED_ROOT = publishedRoot;

    const userId = "user-123";
    const slug = "test-bakery";
    const workspace = path.join(tenantsRoot, userId, slug);
    fs.mkdirSync(path.join(workspace, ".history", "build-1"), { recursive: true });
    fs.mkdirSync(path.join(workspace, "design"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "index.html"), "<!doctype html><title>Test</title>");
    fs.writeFileSync(path.join(workspace, ".history", "build-1", "index.html"), "old snapshot");
    fs.writeFileSync(path.join(workspace, "opencode.json"), "{}");
    fs.writeFileSync(path.join(workspace, "AGENTS.md"), "# agents");
    fs.writeFileSync(path.join(workspace, "design", "plan.json"), "{}");

    // 1. Direct publishWorkspace path
    const publishedDir = publishWorkspace(workspace, slug, publishedRoot);
    expect(fs.existsSync(path.join(publishedDir, "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(publishedDir, ".history"))).toBe(false);
    expect(fs.existsSync(path.join(publishedDir, "opencode.json"))).toBe(false);
    expect(fs.existsSync(path.join(publishedDir, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(publishedDir, "design"))).toBe(false);

    // 2. Admin republishSite path
    fs.rmSync(publishedDir, { recursive: true, force: true });
    vi.mocked(get).mockResolvedValueOnce({ slug, status: "ready", user_id: userId });
    vi.mocked(run).mockResolvedValueOnce({ changes: 1 });

    const res = await republishSite(
      { id: "admin-1", email: "admin@example.com", is_admin: 1, status: "active", created_at: "2026-01-01 00:00:00" },
      "site-1",
      "test republish"
    );
    expect(res.ok).toBe(true);
    expect(fs.existsSync(path.join(publishedDir, "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(publishedDir, ".history"))).toBe(false);
    expect(fs.existsSync(path.join(publishedDir, "opencode.json"))).toBe(false);
    expect(fs.existsSync(path.join(publishedDir, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(publishedDir, "design"))).toBe(false);
  });

  it("removes the old published target before copying and succeeds when publishing the same site twice", () => {
    const workspace = makeTempDir();
    const publishedRoot = makeTempDir();
    const slug = "repeat-publish-site";

    fs.writeFileSync(path.join(workspace, "index.html"), "<!doctype html><title>Version 1</title>");
    fs.writeFileSync(path.join(workspace, "old-asset.txt"), "only in v1");

    const firstTarget = publishWorkspace(workspace, slug, publishedRoot);
    expect(fs.readFileSync(path.join(firstTarget, "index.html"), "utf8")).toContain("Version 1");
    expect(fs.existsSync(path.join(firstTarget, "old-asset.txt"))).toBe(true);

    // Update workspace for second publish without manually deleting firstTarget
    fs.unlinkSync(path.join(workspace, "old-asset.txt"));
    fs.writeFileSync(path.join(workspace, "index.html"), "<!doctype html><title>Version 2</title>");

    const secondTarget = publishWorkspace(workspace, slug, publishedRoot);
    expect(secondTarget).toBe(firstTarget);
    expect(fs.readFileSync(path.join(secondTarget, "index.html"), "utf8")).toContain("Version 2");
    expect(fs.existsSync(path.join(secondTarget, "old-asset.txt"))).toBe(false);
  });

  it("removes regular files with nlink > 1 (hard links) while keeping the outside target intact", () => {
    const outsideDir = makeTempDir();
    const outsideSecret = path.join(outsideDir, "secret.env");
    fs.writeFileSync(outsideSecret, "SECRET=1", { mode: 0o600 });

    const workspace = makeTempDir();
    const normalFile = path.join(workspace, "index.html");
    fs.writeFileSync(normalFile, "<!doctype html><title>Normal</title>");
    const hardLink = path.join(workspace, "hardlinked-secret.txt");
    fs.linkSync(outsideSecret, hardLink);

    expect(fs.lstatSync(hardLink).nlink).toBe(2);
    expect(() => copyWorkspaceNoSymlinks(workspace, path.join(makeTempDir(), "dest"))).toThrow(/hard-linked/);

    chmodRecursive(hardLink);
    expect(fs.statSync(outsideSecret).mode & 0o777).toBe(0o600);

    expect(sanitizeWorkspace(workspace)).toBe(1);
    expect(fs.existsSync(hardLink)).toBe(false);
    expect(fs.existsSync(normalFile)).toBe(true);
    expect(fs.existsSync(outsideSecret)).toBe(true);
    expect(fs.lstatSync(outsideSecret).nlink).toBe(1);
  });
});

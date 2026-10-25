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
});

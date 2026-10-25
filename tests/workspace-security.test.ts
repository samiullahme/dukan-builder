import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { chmodRecursive, copyWorkspaceNoSymlinks, sanitizeWorkspace } from "../lib/workspace-security";

const temporaryRoots: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dukan-workspace-security-"));
  temporaryRoots.push(dir);
  return dir;
}

afterEach(() => {
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
});

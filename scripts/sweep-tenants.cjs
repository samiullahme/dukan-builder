#!/usr/bin/env node
// Dry-run scanner for tenant workspaces (/opt/tenants by default).
// Reports symbolic links and opencode.json files with "bash": "allow".
// Changes nothing unless invoked with --fix.

(async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");

  const args = process.argv.slice(2);
  const fix = args.includes("--fix");
  const rootFlagIndex = args.indexOf("--root");
  const tenantsRoot =
    rootFlagIndex >= 0 && args[rootFlagIndex + 1]
      ? path.resolve(args[rootFlagIndex + 1])
      : path.resolve(process.env.TENANTS_ROOT || "/opt/tenants");

  console.log(
    `[sweep-tenants] mode=${fix ? "FIX" : "DRY-RUN (no changes will be made; pass --fix to apply)"} root=${tenantsRoot}`
  );

  if (!fs.existsSync(tenantsRoot)) {
    console.log(`[sweep-tenants] root directory does not exist: ${tenantsRoot}`);
    return;
  }

  let symlinksFound = 0;
  let symlinksRemoved = 0;
  let bashAllowFound = 0;
  let bashAllowFixed = 0;

  function inspectOpencodeConfig(filePath) {
    let raw = "";
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      console.warn(`[warn] could not read ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    const hasBashAllow =
      (parsed &&
        typeof parsed === "object" &&
        parsed.permission &&
        typeof parsed.permission === "object" &&
        parsed.permission.bash === "allow") ||
      /"bash"\s*:\s*"allow"/.test(raw);

    if (!hasBashAllow) return;

    bashAllowFound++;
    console.log(`[finding:opencode.json] ${filePath} contains "bash": "allow"`);

    if (fix && parsed && typeof parsed === "object") {
      const nextPermission =
        parsed.permission && typeof parsed.permission === "object" ? { ...parsed.permission } : {};
      nextPermission.bash = "deny";
      nextPermission.external_directory = "deny";
      const updated = { ...parsed, permission: nextPermission };
      fs.writeFileSync(filePath, JSON.stringify(updated, null, 2) + "\n");
      bashAllowFixed++;
      console.log(`[fixed:opencode.json] rewrote ${filePath} with bash="deny", external_directory="deny"`);
    }
  }

  function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch (err) {
      console.warn(`[warn] could not list ${dir}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    for (const name of entries) {
      const fullPath = path.join(dir, name);
      let stat;
      try {
        stat = fs.lstatSync(fullPath);
      } catch (err) {
        console.warn(`[warn] could not lstat ${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      if (stat.isSymbolicLink()) {
        symlinksFound++;
        let target = "(unreadable)";
        try {
          target = fs.readlinkSync(fullPath);
        } catch {
          /* ignore */
        }
        console.log(`[finding:symlink] ${fullPath} -> ${target}`);
        if (fix) {
          fs.unlinkSync(fullPath);
          symlinksRemoved++;
          console.log(`[fixed:symlink] unlinked ${fullPath}`);
        }
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile() && name === "opencode.json") {
        inspectOpencodeConfig(fullPath);
      }
    }
  }

  walk(tenantsRoot);

  console.log(
    `[sweep-tenants] done: symlinks_found=${symlinksFound} symlinks_removed=${symlinksRemoved} opencode_bash_allow_found=${bashAllowFound} opencode_bash_allow_fixed=${bashAllowFixed}`
  );
})();

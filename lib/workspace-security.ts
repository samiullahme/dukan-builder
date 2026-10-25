import fs from "fs";
import path from "path";

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/** Remove links and any workspace entry whose resolved path escapes its root. */
export function sanitizeWorkspace(dir: string): number {
  const rootStat = fs.lstatSync(dir);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("workspace root must be a real directory");
  }
  const root = fs.realpathSync(dir);
  let removed = 0;

  const walk = (current: string): void => {
    for (const name of fs.readdirSync(current)) {
      const entry = path.join(current, name);
      const stat = fs.lstatSync(entry);
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(entry);
        removed++;
        continue;
      }

      const real = fs.realpathSync(entry);
      if (!isWithin(root, real)) {
        if (stat.isDirectory()) fs.rmdirSync(entry);
        else fs.unlinkSync(entry);
        removed++;
        continue;
      }

      if (stat.isDirectory()) walk(entry);
      else if (!stat.isFile() || stat.nlink > 1) {
        fs.unlinkSync(entry);
        removed++;
      }
    }
  };

  walk(root);
  return removed;
}

/** Copy a sanitized workspace, failing closed if a link or outside path appears. */
export function copyWorkspaceNoSymlinks(source: string, destination: string): void {
  const sourceStat = fs.lstatSync(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error("workspace source must be a real directory");
  }
  const root = fs.realpathSync(source);

  const copyEntry = (src: string, dest: string): void => {
    const stat = fs.lstatSync(src);
    if (stat.isSymbolicLink()) throw new Error(`refusing to copy workspace symlink: ${src}`);
    const real = fs.realpathSync(src);
    if (!isWithin(root, real)) throw new Error(`refusing to copy workspace path outside root: ${src}`);

    if (stat.isDirectory()) {
      fs.mkdirSync(dest, { recursive: true });
      for (const name of fs.readdirSync(src)) copyEntry(path.join(src, name), path.join(dest, name));
    } else if (stat.isFile()) {
      if (stat.nlink > 1) throw new Error(`refusing to copy hard-linked workspace file: ${src}`);
      fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    } else {
      throw new Error(`refusing to copy unsupported workspace entry: ${src}`);
    }
  };

  copyEntry(source, destination);
}

/** Apply public file modes without following or changing symbolic or hard links. */
export function chmodRecursive(entry: string, directoryMode = 0o755, fileMode = 0o644): void {
  const stat = fs.lstatSync(entry);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    fs.chmodSync(entry, directoryMode);
    for (const name of fs.readdirSync(entry)) chmodRecursive(path.join(entry, name), directoryMode, fileMode);
  } else if (stat.isFile() && stat.nlink === 1) {
    fs.chmodSync(entry, fileMode);
  }
}

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const info = { version: pkg.version, builtAt: new Date().toISOString() };
fs.writeFileSync(path.join(root, "lib", "build-info.json"), JSON.stringify(info, null, 2) + "\n");
console.log(`[build-info] v${info.version} built ${info.builtAt}`);

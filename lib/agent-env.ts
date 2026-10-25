import os from "os";
import { providerKeyForModel } from "./model-chain";

/** Build the small environment OpenCode needs for the selected model(s). */
export function buildAgentEnv(
  models: string | readonly string[],
  source: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const env: Record<string, string> = {
    PATH: source.PATH || "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    HOME: source.HOME || "/home/builder",
    TMPDIR: source.TMPDIR || os.tmpdir(),
    NODE_ENV: source.NODE_ENV || "production",
  };

  const selectedModels = typeof models === "string" ? [models] : models;
  for (const model of selectedModels) {
    const key = providerKeyForModel(model);
    if (key && source[key] !== undefined) env[key] = source[key]!;
  }

  return env as NodeJS.ProcessEnv;
}

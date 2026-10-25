import fs from "fs";
import path from "path";

export type OpenCodePermission = "allow" | "deny";

export type OpenCodeConfig = {
  model: string;
  permission: {
    read: OpenCodePermission;
    edit: OpenCodePermission;
    glob: OpenCodePermission;
    grep: OpenCodePermission;
    list: OpenCodePermission;
    bash: OpenCodePermission;
    external_directory: OpenCodePermission;
  };
  provider?: Record<string, unknown>;
};

export function buildOpenCodeConfig(model: string, env: NodeJS.ProcessEnv = process.env): OpenCodeConfig {
  const config: OpenCodeConfig = {
    model,
    permission: {
      read: "allow",
      edit: "allow",
      glob: "allow",
      grep: "allow",
      list: "allow",
      bash: "deny",
      external_directory: "deny",
    },
  };

  const [provider, ...rest] = model.split("/");
  const modelId = rest.join("/");
  if (provider === "custom" && env.CUSTOM_BASE_URL) {
    config.provider = {
      custom: {
        npm: "@ai-sdk/openai-compatible",
        name: env.CUSTOM_PROVIDER_NAME || "Custom provider",
        options: {
          baseURL: env.CUSTOM_BASE_URL,
          apiKey: "{env:CUSTOM_API_KEY}",
        },
        models: { [modelId]: { name: modelId } },
      },
    };
  }
  if (provider === "freellmapi" && env.FREELLMAPI_BASE_URL) {
    config.provider = {
      freellmapi: {
        npm: "@ai-sdk/openai-compatible",
        name: "FreeLLMAPI",
        options: {
          baseURL: env.FREELLMAPI_BASE_URL,
          apiKey: "{env:FREELLMAPI_KEY}",
        },
        models: { [modelId]: { name: modelId } },
      },
    };
  }

  return config;
}

/** Write the restrictive OpenCode config into the workspace, overwriting any existing file. */
export function writeOpenCodeConfig(
  workspace: string,
  model: string,
  env: NodeJS.ProcessEnv = process.env
): OpenCodeConfig {
  const config = buildOpenCodeConfig(model, env);
  const configPath = path.join(workspace, "opencode.json");
  try {
    if (fs.lstatSync(configPath).isSymbolicLink()) {
      fs.unlinkSync(configPath);
    }
  } catch {
    /* file does not exist yet */
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  return config;
}

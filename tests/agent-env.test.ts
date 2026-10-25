import { describe, expect, it } from "vitest";
import { buildAgentEnv } from "../lib/agent-env";
import { buildOpenCodeConfig } from "../lib/opencode-config";

describe("OpenCode process security", () => {
  it("passes only the process basics and keys for selected providers", () => {
    const env = buildAgentEnv(["deepseek/chat"], {
      PATH: "/usr/bin",
      HOME: "/home/builder",
      TMPDIR: "/tmp",
      NODE_ENV: "test",
      DEEPSEEK_API_KEY: "test-deepseek-key",
      OPENAI_API_KEY: "test-openai-key",
      DATABASE_URL: "postgres://test.invalid/db",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role",
      SITE_ADMIN_ENC_KEY: "test-encryption-key",
      PIXABAY_API_KEY: "test-pixabay-key",
      EXTRA_SECRET: "test-extra-secret",
    });

    expect(Object.keys(env).sort()).toEqual([
      "DEEPSEEK_API_KEY",
      "HOME",
      "NODE_ENV",
      "PATH",
      "TMPDIR",
    ]);
    expect(env.DEEPSEEK_API_KEY).toBe("test-deepseek-key");
    expect(env).not.toHaveProperty("DATABASE_URL");
    expect(env).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(env).not.toHaveProperty("SITE_ADMIN_ENC_KEY");
    expect(env).not.toHaveProperty("PIXABAY_API_KEY");
  });

  it("denies shell and external-directory permissions", () => {
    const config = buildOpenCodeConfig("opencode/free-model");

    expect(config.permission.bash).toBe("deny");
    expect(config.permission.external_directory).toBe("deny");
  });
});

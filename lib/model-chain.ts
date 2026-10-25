/**
 * Model chains accept provider-qualified ids ("provider/model"). OpenCode's
 * own free models need no key; known third-party providers are activated by
 * their standard API-key env vars. A model whose provider has no credentials
 * is skipped instead of being tried and failing with an auth error.
 */
const PROVIDER_KEY_VARS: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  groq: "GROQ_API_KEY",
  xai: "XAI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  custom: "CUSTOM_API_KEY",
  freellmapi: "FREELLMAPI_KEY",
};

export function providerOf(model: string): string {
  return model.split("/")[0] || "";
}

export function isModelUsable(model: string): { ok: boolean; reason?: string } {
  const provider = providerOf(model);
  if (provider === "opencode") return { ok: true };
  const keyVar = PROVIDER_KEY_VARS[provider];
  if (!keyVar) return { ok: false, reason: `unknown provider "${provider}"` };
  if (!process.env[keyVar]) return { ok: false, reason: `${keyVar} is not set` };
  if (provider === "custom" && !process.env.CUSTOM_BASE_URL) {
    return { ok: false, reason: "CUSTOM_BASE_URL is not set" };
  }
  if (provider === "freellmapi" && !process.env.FREELLMAPI_BASE_URL) {
    return { ok: false, reason: "FREELLMAPI_BASE_URL is not set" };
  }
  return { ok: true };
}

export function usableModels(models: string[]): {
  usable: string[];
  skipped: { model: string; reason: string }[];
} {
  const usable: string[] = [];
  const skipped: { model: string; reason: string }[] = [];
  for (const model of models) {
    const verdict = isModelUsable(model);
    if (verdict.ok) usable.push(model);
    else skipped.push({ model, reason: verdict.reason || "unavailable" });
  }
  return { usable, skipped };
}

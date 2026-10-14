/**
 * Bring-your-own AI key: the curated provider registry and the user-facing
 * contract for a stored provider config.
 *
 * Every entry here speaks the OpenAI-compatible chat-completions API (the same
 * wire format the cloud's provider already uses), so adding a provider is just
 * data. Providers that expose a native-only API (Anthropic, Google) still
 * publish an OpenAI-compatible gateway, which is what we point at.
 *
 * The API key itself never appears in these types — it is only ever sent
 * *to* the server, stored encrypted, and never returned to a client.
 */

export interface AiProviderPreset {
  id: string;
  name: string;
  /** OpenAI-compatible base URL. Empty for the user-supplied "custom" entry. */
  baseUrl: string;
  /** A sensible default the UI pre-selects. */
  defaultModel: string;
  /** Suggested model ids (the user may type any model their account allows). */
  models: string[];
  /** Local servers that need no API key. */
  keyless?: boolean;
  /** Providers that think by default and need reasoning echoed back. */
  echoReasoning?: boolean;
}

/** The sentinel id for a user-supplied OpenAI-compatible endpoint. */
export const CUSTOM_AI_PROVIDER_ID = "custom";

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
  },
  {
    id: "anthropic",
    name: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-3-5-sonnet-latest",
    models: ["claude-3-5-sonnet-latest", "claude-3-5-haiku-latest", "claude-3-opus-latest"],
  },
  {
    id: "google",
    name: "Google (Gemini)",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    defaultModel: "gemini-2.0-flash",
    models: ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-1.5-pro"],
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    models: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet", "google/gemini-2.0-flash-001"],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    models: ["deepseek-chat", "deepseek-reasoner"],
    echoReasoning: true,
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
  },
  {
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
    models: ["mistral-large-latest", "mistral-small-latest", "open-mistral-nemo"],
  },
  {
    id: "xai",
    name: "xAI (Grok)",
    baseUrl: "https://api.x.ai/v1",
    defaultModel: "grok-2-latest",
    models: ["grok-2-latest", "grok-2-mini", "grok-beta"],
  },
  {
    id: "together",
    name: "Together AI",
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-72B-Instruct-Turbo"],
  },
  {
    id: "fireworks",
    name: "Fireworks",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    models: ["accounts/fireworks/models/llama-v3p3-70b-instruct"],
  },
  {
    id: "perplexity",
    name: "Perplexity",
    baseUrl: "https://api.perplexity.ai",
    defaultModel: "sonar",
    models: ["sonar", "sonar-pro"],
  },
  {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "moonshot-v1-8k",
    models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    baseUrl: "http://localhost:11434/v1",
    defaultModel: "llama3.1",
    models: ["llama3.1", "qwen2.5", "mistral"],
    keyless: true,
  },
  {
    id: "lmstudio",
    name: "LM Studio (local)",
    baseUrl: "http://localhost:1234/v1",
    defaultModel: "local-model",
    models: ["local-model"],
    keyless: true,
  },
  {
    id: CUSTOM_AI_PROVIDER_ID,
    name: "Custom (OpenAI-compatible)",
    baseUrl: "",
    defaultModel: "",
    models: [],
  },
];

export function findAiProviderPreset(id: string): AiProviderPreset | undefined {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === id);
}

/**
 * A stored, user-owned provider config. `hasKey` reports whether a key is
 * present; the key value itself is never included.
 */
export interface AiKeyConfig {
  /** Preset id, or `custom`. */
  provider: string;
  model: string;
  /** Overrides the preset base URL (required for `custom`). */
  baseUrl?: string;
  /** Whether the user wants their own key used for their tasks. */
  enabled: boolean;
  /** True when a key is stored (always false for keyless local presets). */
  hasKey: boolean;
  updatedAt?: string;
}

/** What a client may send to store a provider config. */
export interface AiKeyInput {
  provider: string;
  model: string;
  baseUrl?: string;
  /** Omit to keep the existing key (e.g. when only the model changes). */
  apiKey?: string;
  enabled?: boolean;
}

export interface AiKeyTestResult {
  ok: boolean;
  message: string;
}

/**
 * Resolve the effective base URL for a config: an explicit override wins,
 * otherwise the preset's URL. Returns null when the config can't be resolved
 * (unknown preset without an override, or `custom` with no URL).
 */
export function resolveAiBaseUrl(config: Pick<AiKeyConfig, "provider" | "baseUrl">): string | null {
  const override = (config.baseUrl ?? "").trim();
  if (override) return override.replace(/\/+$/, "");
  const preset = findAiProviderPreset(config.provider);
  if (!preset || !preset.baseUrl) return null;
  return preset.baseUrl.replace(/\/+$/, "");
}

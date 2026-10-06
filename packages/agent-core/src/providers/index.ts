import type { ModelProvider } from "../types.js";
import { createMockProvider } from "./mock.js";
import { createOpenAIProvider } from "./openai.js";

export { createMockProvider } from "./mock.js";
export { createOpenAIProvider } from "./openai.js";
export type { OpenAIProviderOptions } from "./openai.js";

export type ProviderName = "mock" | "openai" | "openrouter" | "deepseek" | "groq" | "ollama";

interface Preset {
  baseUrl: string;
  model: string;
  keyEnv?: string;
}

const PRESETS: Record<Exclude<ProviderName, "mock">, Preset> = {
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyEnv: "OPENAI_API_KEY" },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    keyEnv: "OPENROUTER_API_KEY",
  },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", keyEnv: "DEEPSEEK_API_KEY" },
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    keyEnv: "GROQ_API_KEY",
  },
  ollama: { baseUrl: "http://localhost:11434/v1", model: "llama3.1" },
};

export interface ProviderSelection {
  /** Explicit provider name, or "auto" to infer from available keys. */
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  /** Where the keyless mock provider should point the browser. */
  demoUrl: string;
}

/** Pick the best provider from whatever keys happen to be set. */
export function detectProvider(): ProviderName {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.OPENROUTER_API_KEY) return "openrouter";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek";
  if (process.env.GROQ_API_KEY) return "groq";
  return "mock";
}

export function createProvider(selection: ProviderSelection): ModelProvider {
  const requested = (selection.provider ?? "auto").toLowerCase();
  const name = (requested === "auto" ? detectProvider() : requested) as ProviderName;

  if (name === "mock") {
    return createMockProvider(selection.demoUrl);
  }

  const preset = PRESETS[name];
  if (!preset) {
    throw new Error(`unknown provider "${selection.provider}"`);
  }

  const apiKey = selection.apiKey ?? (preset.keyEnv ? process.env[preset.keyEnv] : undefined);
  const model = selection.model ?? preset.model;

  const masked = apiKey ? `…${apiKey.slice(-4)}` : "(none)";
  console.log(`[botifyr] model provider "${name}" model "${model}" key ${masked}`);

  return createOpenAIProvider({
    baseUrl: selection.baseUrl ?? preset.baseUrl,
    model,
    apiKey,
  });
}

import { randomUUID } from "node:crypto";
import { createProvider, type ModelProvider } from "@botifyr/agent-core";
import {
  CUSTOM_AI_PROVIDER_ID,
  findAiProviderPreset,
  resolveAiBaseUrl,
  type AiKeyConfig,
  type AiKeyInput,
} from "@botifyr/shared";
import type { Store } from "./store/types.js";
import { decryptSecret, encryptSecret } from "./vault.js";

/**
 * Per-user, bring-your-own AI key.
 *
 * The whole config (provider, model, base URL and the API key) is stored as a
 * single encrypted vault secret, so it reuses the existing AES-256-GCM vault and
 * never needs a schema change. The key is never returned to a client — only
 * `hasKey` is exposed.
 */

/** Vault secret name holding the user's AI config (JSON). */
export const AI_CONFIG_SECRET = "BOTIFYR_AI_CONFIG";

interface StoredAiConfig {
  provider: string;
  model: string;
  baseUrl?: string;
  enabled: boolean;
  apiKey?: string;
  updatedAt?: string;
}

async function readStored(
  store: Store,
  vaultKey: Buffer,
  userId: string,
): Promise<StoredAiConfig | null> {
  const record = await store.getSecret(userId, AI_CONFIG_SECRET);
  if (!record) return null;
  try {
    const raw = JSON.parse(decryptSecret(vaultKey, record)) as StoredAiConfig;
    if (!raw || typeof raw !== "object" || typeof raw.provider !== "string") return null;
    return raw;
  } catch {
    return null;
  }
}

/** Public (key-free) view of a stored config. */
export function toPublicAiConfig(stored: StoredAiConfig): AiKeyConfig {
  return {
    provider: stored.provider,
    model: stored.model,
    baseUrl: stored.baseUrl,
    enabled: stored.enabled,
    hasKey: Boolean(stored.apiKey),
    updatedAt: stored.updatedAt,
  };
}

/** The user's stored config without the secret, or null when none is set. */
export async function loadAiKey(
  store: Store,
  vaultKey: Buffer,
  userId: string,
): Promise<AiKeyConfig | null> {
  const stored = await readStored(store, vaultKey, userId);
  return stored ? toPublicAiConfig(stored) : null;
}

/** Validate raw input; returns a user-facing error, or null when valid. */
export function validateAiInput(input: AiKeyInput, hasExistingKey: boolean): string | null {
  const provider = (input.provider ?? "").trim();
  const preset = findAiProviderPreset(provider);
  if (!preset) return `Unknown provider "${provider}".`;

  const model = (input.model ?? "").trim() || preset.defaultModel;
  if (!model) return "A model is required.";

  const baseUrl = (input.baseUrl ?? "").trim();
  if (provider === CUSTOM_AI_PROVIDER_ID || baseUrl) {
    const url = resolveAiBaseUrl({ provider, baseUrl });
    if (!url) return "A base URL is required for a custom provider.";
    if (!/^https?:\/\//i.test(url)) return "The base URL must start with http:// or https://.";
  }

  const key = (input.apiKey ?? "").trim();
  if (!preset.keyless && !key && !hasExistingKey) {
    return "An API key is required.";
  }
  return null;
}

/** Create or replace the user's AI config. Returns the key-free view. */
export async function saveAiKey(
  store: Store,
  vaultKey: Buffer,
  userId: string,
  input: AiKeyInput,
): Promise<AiKeyConfig> {
  const existing = await readStored(store, vaultKey, userId);
  const preset = findAiProviderPreset((input.provider ?? "").trim());
  const provider = preset?.id ?? (input.provider ?? "").trim();
  const model = (input.model ?? "").trim() || preset?.defaultModel || "";
  const baseUrl = (input.baseUrl ?? "").trim() || undefined;
  // Omit `apiKey` to keep the previous key (e.g. editing only the model).
  const apiKey = (input.apiKey ?? "").trim() || existing?.apiKey;

  const stored: StoredAiConfig = {
    provider,
    model,
    baseUrl,
    enabled: input.enabled ?? existing?.enabled ?? true,
    apiKey,
    updatedAt: new Date().toISOString(),
  };

  const encrypted = encryptSecret(vaultKey, JSON.stringify(stored));
  // Upsert by name: drop the old row (if any), then create the fresh one.
  const old = await store.getSecret(userId, AI_CONFIG_SECRET);
  if (old) await store.deleteSecret(userId, old.id);
  await store.createSecret({
    id: randomUUID(),
    userId,
    name: AI_CONFIG_SECRET,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    tag: encrypted.tag,
    createdAt: new Date().toISOString(),
  });

  return toPublicAiConfig(stored);
}

/** Remove the user's AI config entirely. */
export async function clearAiKey(store: Store, userId: string): Promise<void> {
  const existing = await store.getSecret(userId, AI_CONFIG_SECRET);
  if (existing) await store.deleteSecret(userId, existing.id);
}

/** Build a provider from a stored config, or null when it isn't usable. */
export function buildProviderFromKey(stored: StoredAiConfig, demoUrl: string): ModelProvider | null {
  const baseUrl = resolveAiBaseUrl(stored);
  if (!baseUrl) return null;
  const preset = findAiProviderPreset(stored.provider);
  if (!preset?.keyless && !stored.apiKey) return null;
  const model = stored.model || preset?.defaultModel || "";
  if (!model) return null;
  return createProvider({
    provider: "openai-compatible",
    baseUrl,
    model,
    apiKey: stored.apiKey,
    demoUrl,
  });
}

/**
 * The provider to use for a user's task: their own key when enabled and usable,
 * otherwise null (the caller falls back to the platform provider).
 */
export async function userProvider(
  store: Store,
  vaultKey: Buffer,
  userId: string,
  demoUrl: string,
): Promise<ModelProvider | null> {
  const stored = await readStored(store, vaultKey, userId);
  if (!stored || !stored.enabled) return null;
  return buildProviderFromKey(stored, demoUrl);
}

/** True when the user has an enabled, usable own key (used to bypass quota). */
export async function hasUsableOwnKey(store: Store, vaultKey: Buffer, userId: string): Promise<boolean> {
  const stored = await readStored(store, vaultKey, userId);
  if (!stored || !stored.enabled) return false;
  return buildProviderFromKey(stored, "http://localhost") !== null;
}

/**
 * Build a provider from unsaved input (for "test connection"), merging in any
 * previously stored key so a user can re-test without re-pasting it.
 */
export async function providerForInput(
  store: Store,
  vaultKey: Buffer,
  userId: string,
  input: AiKeyInput,
  demoUrl: string,
): Promise<ModelProvider> {
  const existing = await readStored(store, vaultKey, userId);
  const preset = findAiProviderPreset((input.provider ?? "").trim());
  const merged: StoredAiConfig = {
    provider: preset?.id ?? (input.provider ?? "").trim(),
    model: (input.model ?? "").trim() || existing?.model || preset?.defaultModel || "",
    baseUrl: (input.baseUrl ?? "").trim() || undefined,
    enabled: true,
    apiKey: (input.apiKey ?? "").trim() || existing?.apiKey,
  };
  const provider = buildProviderFromKey(merged, demoUrl);
  if (!provider) throw new Error("The provider configuration is incomplete.");
  return provider;
}

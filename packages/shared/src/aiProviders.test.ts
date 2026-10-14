import { describe, expect, it } from "vitest";
import {
  AI_PROVIDER_PRESETS,
  CUSTOM_AI_PROVIDER_ID,
  findAiProviderPreset,
  resolveAiBaseUrl,
} from "./aiProviders.js";

describe("AI provider registry", () => {
  it("has unique ids and a base URL for every preset except custom", () => {
    const ids = AI_PROVIDER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of AI_PROVIDER_PRESETS) {
      if (preset.id === CUSTOM_AI_PROVIDER_ID) {
        expect(preset.baseUrl).toBe("");
      } else {
        expect(preset.baseUrl).toMatch(/^https?:\/\//);
        expect(preset.defaultModel.length).toBeGreaterThan(0);
      }
    }
  });

  it("resolves the preset URL, honours an override, and fails for custom without one", () => {
    expect(resolveAiBaseUrl({ provider: "openai" })).toBe("https://api.openai.com/v1");
    expect(resolveAiBaseUrl({ provider: "openai", baseUrl: "http://localhost:8080/v1/" })).toBe(
      "http://localhost:8080/v1",
    );
    expect(resolveAiBaseUrl({ provider: CUSTOM_AI_PROVIDER_ID })).toBeNull();
    expect(resolveAiBaseUrl({ provider: "nope" })).toBeNull();
  });

  it("includes keyless local providers", () => {
    expect(findAiProviderPreset("ollama")?.keyless).toBe(true);
    expect(findAiProviderPreset("openai")?.keyless).toBeUndefined();
  });
});

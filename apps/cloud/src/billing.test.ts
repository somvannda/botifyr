import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { priceFor, verifyChmabaSignature } from "./billing.js";
import type { ModelPricingRecord } from "./store/types.js";

function pricing(partial: Partial<ModelPricingRecord> & { model: string }): ModelPricingRecord {
  return {
    provider: "deepseek",
    inputCentsPerM: 27,
    outputCentsPerM: 110,
    enabled: true,
    updatedAt: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("priceFor", () => {
  it("charges provider cost plus the global markup, rounded up", () => {
    // 1M input + 1M output = 27 + 110 = 137¢; +15% = 157.55 → 158
    const charge = priceFor([pricing({ model: "deepseek-chat" })], "deepseek-chat", 1_000_000, 1_000_000, 15);
    expect(charge).toBe(158);
  });

  it("honours a per-model markup override", () => {
    const rows = [pricing({ model: "x", inputCentsPerM: 100, outputCentsPerM: 0, markupPercent: 50 })];
    expect(priceFor(rows, "x", 1_000_000, 0, 15)).toBe(150);
  });

  it("falls back to the most expensive enabled model when unknown", () => {
    const rows = [
      pricing({ model: "cheap", inputCentsPerM: 10, outputCentsPerM: 10 }),
      pricing({ model: "pricey", inputCentsPerM: 200, outputCentsPerM: 200 }),
      pricing({ model: "off", inputCentsPerM: 9999, outputCentsPerM: 9999, enabled: false }),
    ];
    // unknown → pricey (400¢/M) +15% = 460
    expect(priceFor(rows, "mystery", 1_000_000, 1_000_000, 15)).toBe(460);
  });

  it("is zero with no enabled pricing rows", () => {
    expect(priceFor([], "x", 1_000_000, 1_000_000, 15)).toBe(0);
  });
});

describe("verifyChmabaSignature", () => {
  const secret = "whsec_test";
  const body = Buffer.from(JSON.stringify({ type: "payment.completed" }));

  it("accepts a fresh, correctly signed body", () => {
    const t = Math.floor(Date.now() / 1000).toString();
    const v1 = createHmac("sha256", secret)
      .update(`${t}.${body.toString("utf8")}`)
      .digest("hex");
    expect(verifyChmabaSignature(body, `t=${t},v1=${v1}`, secret)).toBe(true);
  });

  it("rejects a tampered signature and a stale timestamp", () => {
    const t = Math.floor(Date.now() / 1000).toString();
    expect(verifyChmabaSignature(body, `t=${t},v1=deadbeef`, secret)).toBe(false);
    const old = (Math.floor(Date.now() / 1000) - 3600).toString();
    const v1 = createHmac("sha256", secret)
      .update(`${old}.${body.toString("utf8")}`)
      .digest("hex");
    expect(verifyChmabaSignature(body, `t=${old},v1=${v1}`, secret)).toBe(false);
  });
});

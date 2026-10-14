import { describe, expect, it } from "vitest";
import { classifyModelError, describeModelError, friendlyModelError } from "./errors.js";

describe("describeModelError", () => {
  it("classifies an out-of-credit provider error (the 402 JSON body)", () => {
    const error = new Error(
      'model request failed (402): {"error":{"message":"Insufficient Balance","type":"unknown_error","param":null,"code":"invalid_request_error"}}',
    );
    const info = describeModelError(error);
    expect(info.kind).toBe("credit");
    expect(info.message).toMatch(/out of credit/i);
    // Never leak the raw provider JSON to the user.
    expect(info.message).not.toMatch(/invalid_request_error|request_id|\{/);
  });

  it("classifies auth, rate-limit, 5xx and network failures", () => {
    expect(classifyModelError(new Error("model request failed (401): invalid api key"))).toBe("auth");
    expect(classifyModelError(new Error("model request failed (429): rate limit exceeded"))).toBe("rate_limit");
    expect(classifyModelError(new Error("model request failed (503): service unavailable"))).toBe(
      "unavailable",
    );
    expect(classifyModelError(new Error("fetch failed"))).toBe("network");
  });

  it("falls back to a generic message for unknown errors", () => {
    const info = describeModelError(new Error("kaboom"));
    expect(info.kind).toBe("unknown");
    expect(friendlyModelError(new Error("kaboom"))).toBe(info.message);
  });

  it("handles non-Error throwables", () => {
    expect(classifyModelError("402 payment required")).toBe("credit");
  });
});

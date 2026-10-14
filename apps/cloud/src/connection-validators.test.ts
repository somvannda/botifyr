import { afterEach, describe, expect, it, vi } from "vitest";
import { validateConnection } from "./connection-validators.js";

/** Provider key validation (docs/camxora.md): a cheap whoami per token app. */
describe("connection validators", () => {
  afterEach(() => vi.restoreAllMocks());

  it("accepts a valid Camxora key and reports the credits", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ credits: 42 }), { status: 200 }),
    );
    const result = await validateConnection("camxora", "k");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("42");
  });

  it("rejects an invalid Camxora key (401)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const result = await validateConnection("camxora", "bad");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Invalid");
  });

  it("reads a GitHub login", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ login: "octocat" }), { status: 200 }),
    );
    const result = await validateConnection("github", "k");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("@octocat");
  });

  it("passes through apps it can't auto-check without blocking", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const result = await validateConnection("linear", "k");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("can't be auto-checked");
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports a network failure as not-ok", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    const result = await validateConnection("camxora", "k");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("offline");
  });

  it("validates a Zernio key and counts accounts", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accounts: [{ _id: "a" }, { _id: "b" }] }), { status: 200 }),
    );
    const result = await validateConnection("zernio", "k");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("2 account");
  });

  it("rejects an invalid Post for Me key (401)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 401 }));
    const result = await validateConnection("postforme", "bad");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Invalid");
  });

  it("validates a Publora key against its connections", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ connections: [{ platformId: "linkedin-1" }] }), { status: 200 }),
    );
    const result = await validateConnection("publora", "k");
    expect(result.ok).toBe(true);
    expect(result.message).toContain("1 connection");
  });
});

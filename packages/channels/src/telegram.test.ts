import { afterEach, describe, expect, it, vi } from "vitest";
import { createTelegramChannel } from "./telegram.js";

/**
 * The Telegram adapter's getChat is what lets a contact show a real name instead
 * of a raw chat id (docs/external-communications.md §4). It must never throw:
 * identity is nice-to-have, and a failed lookup must not drop a real message.
 */

function stubFetch(payload: unknown): void {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => payload }));
}

describe("telegram getChat", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads a group or channel title", async () => {
    stubFetch({ result: { title: "Acme Support", username: "acme_support" } });
    const channel = createTelegramChannel({ token: "t" });
    expect(await channel.getChat?.("chat-9")).toEqual({
      name: "Acme Support",
      handle: "acme_support",
    });
  });

  it("joins a private chat's first and last name", async () => {
    stubFetch({ result: { first_name: "Sokha", last_name: "Chan" } });
    const channel = createTelegramChannel({ token: "t" });
    expect(await channel.getChat?.("chat-9")).toEqual({ name: "Sokha Chan", handle: undefined });
  });

  it("returns null rather than throwing when Telegram is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const channel = createTelegramChannel({ token: "t" });
    expect(await channel.getChat?.("chat-9")).toBeNull();
  });
});

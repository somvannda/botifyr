import { describe, expect, it } from "vitest";
import { createTelegramSocialClient, resolveTelegramChannel } from "./social-telegram.js";

describe("telegram social client", () => {
  function recorder() {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string, init: { body: string }) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) as Record<string, unknown> });
      if (String(url).endsWith("/getChat")) {
        return { json: async () => ({ ok: true, result: { title: "News", member_count: 42 } }) };
      }
      return { json: async () => ({ ok: true, result: { message_id: 1 } }) };
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("reads insights, publishes and replies through the Bot API", async () => {
    const { calls, fetchImpl } = recorder();
    const client = createTelegramSocialClient({ token: "T", chatId: 555, fetchImpl });

    expect(await client.readInsights()).toContain("42");
    await client.publish("Hello");
    await client.reply("9", "Thanks");

    const sends = calls.filter((call) => call.url.endsWith("/sendMessage"));
    expect(sends[0]?.body).toMatchObject({ chat_id: 555, text: "Hello" });
    expect(sends[1]?.body).toMatchObject({ chat_id: 555, text: "Thanks", reply_to_message_id: 9 });
  });

  it("throws on a Telegram error", async () => {
    const fetchImpl = (async () => ({
      json: async () => ({ ok: false, description: "chat not found" }),
    })) as unknown as typeof fetch;
    const client = createTelegramSocialClient({ token: "T", chatId: 1, fetchImpl });
    await expect(client.publish("x")).rejects.toThrow("chat not found");
  });

  it("prefers a company's workspace channel over env + the owner's personal chat", () => {
    expect(
      resolveTelegramChannel({
        workspaceToken: "WS_TOKEN",
        workspaceChatId: "-100999",
        envToken: "ENV_TOKEN",
        personalChatId: "4242",
      }),
    ).toEqual({ token: "WS_TOKEN", chatId: "-100999" });
  });

  it("falls back to the env token + the owner's personal chat", () => {
    expect(resolveTelegramChannel({ envToken: "ENV_TOKEN", personalChatId: 4242 })).toEqual({
      token: "ENV_TOKEN",
      chatId: "4242",
    });
  });

  it("returns null when the channel isn't configured", () => {
    expect(resolveTelegramChannel({ envToken: "ENV_TOKEN" })).toBeNull();
    expect(resolveTelegramChannel({ personalChatId: "4242" })).toBeNull();
    expect(resolveTelegramChannel({ workspaceToken: "  ", workspaceChatId: "-100" })).toBeNull();
  });
});

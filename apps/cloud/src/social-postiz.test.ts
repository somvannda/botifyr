import { describe, expect, it } from "vitest";
import { createPostizSocialClient } from "./social-postiz.js";

describe("postiz social client", () => {
  function recorder(response: unknown) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return { ok: true, json: async () => response };
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  }

  it("publishes a 'now' post", async () => {
    const { calls, fetchImpl } = recorder({ id: "p1" });
    const client = createPostizSocialClient({
      apiKey: "k",
      integrationId: "i1",
      platform: "facebook",
      fetchImpl,
    });
    expect(await client.publish("Hello")).toContain("facebook");
    const { url, init } = calls[0]!;
    expect(url).toContain("/public/v1/posts");
    expect((init.headers as Record<string, string>).authorization).toBe("k");
    const body = JSON.parse(String(init.body));
    expect(body.type).toBe("now");
    expect(body.posts[0].integration.id).toBe("i1");
    expect(body.posts[0].settings.__type).toBe("facebook");
    expect(body.posts[0].value[0].content).toBe("Hello");
  });

  it("reads the channel from /integrations", async () => {
    const { fetchImpl } = recorder([{ id: "i1", name: "Acme Page", providerIdentifier: "facebook" }]);
    const client = createPostizSocialClient({
      apiKey: "k",
      integrationId: "i1",
      platform: "facebook",
      fetchImpl,
    });
    expect(await client.readInsights()).toContain("Acme Page");
  });

  it("explains that Postiz can't reply", async () => {
    const { fetchImpl } = recorder({});
    const client = createPostizSocialClient({ apiKey: "k", integrationId: "i1", platform: "x", fetchImpl });
    expect(await client.reply("1", "hi")).toContain("browser");
  });

  it("throws on a Postiz error", async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 401,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    const client = createPostizSocialClient({ apiKey: "k", integrationId: "i1", platform: "x", fetchImpl });
    await expect(client.publish("x")).rejects.toThrow("Postiz 401");
  });
});

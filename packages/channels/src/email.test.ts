import { describe, expect, it, vi } from "vitest";
import { createEmailChannel } from "./email.js";

/**
 * Email as a channel (docs/external-communications.md §13): outbound goes to
 * Resend with the workspace's own key; a rejection must surface, not be silent.
 */

function stubFetch(ok = true, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status, json: async () => ({ id: "e1" }) });
  return fetchMock;
}

describe("email channel", () => {
  it("sends via Resend with the workspace key and from-address", async () => {
    const fetchMock = stubFetch();
    const channel = createEmailChannel({
      apiKey: "re_ws",
      from: "Bot <bot@acme.com>",
      fetchImpl: fetchMock,
    });
    await channel.send("lead@customer.com", "Thanks for reaching out.", { subject: "Hello" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect((init as RequestInit).headers).toMatchObject({ authorization: "Bearer re_ws" });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      from: "Bot <bot@acme.com>",
      to: "lead@customer.com",
      subject: "Hello",
      text: "Thanks for reaching out.",
    });
  });

  it("defaults the subject when none is given", async () => {
    const fetchMock = stubFetch();
    const channel = createEmailChannel({ apiKey: "k", from: "a@b.c", fetchImpl: fetchMock });
    await channel.send("lead@customer.com", "hi");
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body)).subject).toBe(
      "Re: your message",
    );
  });

  it("throws when Resend rejects the send", async () => {
    const channel = createEmailChannel({ apiKey: "k", from: "a@b.c", fetchImpl: stubFetch(false, 422) });
    await expect(channel.send("lead@customer.com", "hi")).rejects.toThrow(/422/);
  });
});

import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseResendInbound, verifyResendSignature } from "./email-inbound.js";

/**
 * Resend's inbound webhook is authenticated by its Svix signature
 * (docs/external-communications.md §13). These tests compute the signature the
 * same way Svix does, so no Resend account is needed.
 */

const RAW_SECRET = Buffer.from("super-secret-signing-key").toString("base64");
const SECRET = `whsec_${RAW_SECRET}`;

function sign(body: string, id = "msg_1", timestamp = "1700000000"): string {
  const digest = createHmac("sha256", Buffer.from(RAW_SECRET, "base64"))
    .update(`${id}.${timestamp}.${body}`)
    .digest("base64");
  return `v1,${digest}`;
}

describe("verifyResendSignature", () => {
  const body = JSON.stringify({ type: "email.received" });

  it("accepts a correctly signed payload", () => {
    expect(
      verifyResendSignature(
        SECRET,
        { id: "msg_1", timestamp: "1700000000", signature: sign(body) },
        body,
      ),
    ).toBe(true);
  });

  it("accepts a signature among several", () => {
    const headers = { id: "msg_1", timestamp: "1700000000", signature: `v1,AAAA ${sign(body)}` };
    expect(verifyResendSignature(SECRET, headers, body)).toBe(true);
  });

  it("rejects a tampered body, a wrong secret, or missing headers", () => {
    const headers = { id: "msg_1", timestamp: "1700000000", signature: sign(body) };
    expect(verifyResendSignature(SECRET, headers, `${body} `)).toBe(false);
    expect(verifyResendSignature(`whsec_${Buffer.from("other").toString("base64")}`, headers, body)).toBe(
      false,
    );
    expect(verifyResendSignature(SECRET, { id: "msg_1" }, body)).toBe(false);
    expect(verifyResendSignature("", headers, body)).toBe(false);
  });
});

describe("parseResendInbound", () => {
  it("takes the address out of a display-name From and prefers the text part", () => {
    expect(
      parseResendInbound({
        type: "email.received",
        data: { from: "Sokha Chan <sokha@customer.com>", subject: "Delivery", text: "Do you deliver?" },
      }),
    ).toEqual({ from: "sokha@customer.com", subject: "Delivery", text: "Do you deliver?" });
  });

  it("falls back to stripped HTML when there is no text part", () => {
    const parsed = parseResendInbound({
      data: { from: "sokha@customer.com", html: "<p>Hello <b>there</b></p>" },
    });
    expect(parsed?.text).toBe("Hello there");
  });

  it("returns null without a sender or a data payload", () => {
    expect(parseResendInbound({ data: { text: "hi" } })).toBeNull();
    expect(parseResendInbound({ type: "email.received" })).toBeNull();
  });
});

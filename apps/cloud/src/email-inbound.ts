import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Resend's inbound webhooks are signed by Svix
 * (docs/external-communications.md §13): the signed content is
 * `${svix-id}.${svix-timestamp}.${rawBody}`, HMAC-SHA256 with the base64 secret
 * (after the `whsec_` prefix), base64-encoded. Kept pure and dependency-free so
 * it is unit-testable without a Resend account.
 */

export interface SvixHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}

export function verifyResendSignature(secret: string, headers: SvixHeaders, body: string): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const key = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  let expected: string;
  try {
    expected = createHmac("sha256", Buffer.from(key, "base64"))
      .update(`${id}.${timestamp}.${body}`)
      .digest("base64");
  } catch {
    return false;
  }
  const expectedBytes = Buffer.from(expected);
  // The header carries one or more space-separated `v1,<base64>` signatures.
  return signature.split(" ").some((part) => {
    const value = part.includes(",") ? part.slice(part.indexOf(",") + 1) : part;
    const actual = Buffer.from(value);
    return actual.length === expectedBytes.length && timingSafeEqual(actual, expectedBytes);
  });
}

/** The fields of a Resend `email.received` event we route on. */
export interface InboundEmail {
  from: string;
  subject: string;
  text: string;
}

function firstAddress(value: unknown): string {
  const raw = String(value ?? "").trim();
  // `Acme <hello@acme.com>` → `hello@acme.com`.
  const angled = raw.match(/<([^>]+)>/);
  return (angled?.[1] ?? raw).trim();
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map a Resend inbound payload to the channel message we route on, or null. */
export function parseResendInbound(payload: unknown): InboundEmail | null {
  const data = (payload as { data?: Record<string, unknown> } | null)?.data;
  if (!data) return null;
  const from = firstAddress(data.from);
  if (!from) return null;
  const text = String(data.text ?? "").trim() || stripHtml(String(data.html ?? ""));
  return { from, subject: String(data.subject ?? "").trim(), text };
}

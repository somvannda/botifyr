import type { ChannelAdapter, ChannelMessageHandler } from "./types.js";

export interface EmailOptions {
  /** The workspace's own Resend key (docs/external-communications.md §13). */
  apiKey: string;
  /** The verified from-address, e.g. `Bot <bot@acme.com>`. */
  from: string;
  /** Override for tests / self-hosted proxies. */
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Email as a channel: outbound goes to Resend, and inbound is handed in by the
 * cloud's Resend webhook (via `ChannelService.ingest`). Registering it as an
 * adapter means an email thread reuses the same routing, contact/thread upsert,
 * approval gate and trust model as Telegram — so nothing in the UI is email-aware.
 *
 * There is nothing to poll, so `start`/`stop` are no-ops.
 */
export function createEmailChannel(options: EmailOptions): ChannelAdapter {
  const api = (options.apiBase ?? "https://api.resend.com").replace(/\/$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  const handlers: ChannelMessageHandler[] = [];

  return {
    name: "email",
    onMessage(handler) {
      handlers.push(handler);
    },
    async send(conversationId, text, sendOptions) {
      const response = await doFetch(`${api}/emails`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: options.from,
          to: conversationId,
          subject: sendOptions?.subject ?? "Re: your message",
          text,
        }),
      });
      if (!response.ok) {
        // The service records failures; surfacing them beats a silent no-op.
        throw new Error(`Resend rejected the email (${response.status})`);
      }
    },
    // Inbound arrives via the webhook, not a poll loop.
    async start() {},
    async stop() {},
  };
}

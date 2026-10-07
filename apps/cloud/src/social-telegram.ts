import type { SocialClient } from "./social-tools.js";

/**
 * A real "hand": a SocialClient backed by the Telegram Bot API (docs/
 * company-workspace.md Part V §40). Posting to a channel and replying are the
 * first working, no-approval-needed channel. `fetchImpl` is injectable for tests.
 */

export interface TelegramSocialOptions {
  token: string;
  /** The channel/chat to post to (a user's linked chat id). */
  chatId: string | number;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

interface TelegramEnvelope<T> {
  ok?: boolean;
  result?: T;
  description?: string;
}

export function createTelegramSocialClient(options: TelegramSocialOptions): SocialClient {
  const api = (options.apiBase ?? "https://api.telegram.org").replace(/\/$/, "");
  const base = `${api}/bot${options.token}`;
  const doFetch = options.fetchImpl ?? fetch;
  const chatId = options.chatId;

  async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
    const response = await doFetch(`${base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json()) as TelegramEnvelope<T>;
    if (!json.ok) throw new Error(json.description ?? `Telegram ${method} failed`);
    return json.result as T;
  }

  return {
    provider: "Telegram",
    async readInsights() {
      const chat = await call<{ title?: string; member_count?: number }>("getChat", { chat_id: chatId });
      return `Telegram "${chat.title ?? chatId}": ${chat.member_count ?? "?"} members.`;
    },
    async publish(text) {
      await call("sendMessage", { chat_id: chatId, text });
      return `Posted to Telegram (${chatId}).`;
    },
    async reply(threadId, text) {
      const replyTo = Number(threadId);
      await call("sendMessage", {
        chat_id: chatId,
        text,
        ...(Number.isFinite(replyTo) ? { reply_to_message_id: replyTo } : {}),
      });
      return `Replied on Telegram (${threadId}).`;
    },
  };
}

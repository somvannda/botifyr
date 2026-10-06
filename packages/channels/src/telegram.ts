import type { ChannelAdapter, ChannelMessageHandler } from "./types.js";

/**
 * Telegram channel via the Bot API, using long polling so it needs no public
 * URL. Enable by setting TELEGRAM_BOT_TOKEN. Conversations are keyed by chat id.
 */

export interface TelegramOptions {
  token: string;
  apiBase?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id?: number | string };
    from?: { id?: number | string };
  };
}

export function createTelegramChannel(options: TelegramOptions): ChannelAdapter {
  const api = (options.apiBase ?? "https://api.telegram.org").replace(/\/$/, "");
  const base = `${api}/bot${options.token}`;
  const handlers: ChannelMessageHandler[] = [];
  let running = false;
  let offset = 0;

  async function call<T>(method: string, body?: unknown): Promise<T> {
    const response = await fetch(`${base}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return (await response.json()) as T;
  }

  async function poll(): Promise<void> {
    while (running) {
      try {
        const data = await call<{ result?: TelegramUpdate[] }>("getUpdates", { timeout: 30, offset });
        for (const update of data.result ?? []) {
          offset = update.update_id + 1;
          const message = update.message;
          if (!message?.text || message.chat?.id === undefined) continue;
          const envelope = {
            conversationId: String(message.chat.id),
            text: String(message.text),
            senderId: message.from?.id !== undefined ? String(message.from.id) : undefined,
          };
          for (const handler of handlers) handler(envelope);
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }
  }

  return {
    name: "telegram",
    onMessage(handler) {
      handlers.push(handler);
    },
    async send(conversationId, text) {
      await call("sendMessage", { chat_id: conversationId, text });
    },
    async start() {
      running = true;
      void poll();
    },
    async stop() {
      running = false;
    },
  };
}

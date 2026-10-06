import { randomUUID } from "node:crypto";
import type { ChannelAdapter, ChannelMessageHandler } from "./types.js";

/**
 * Local channel: an in-process, authenticated chat transport. The cloud exposes
 * it over HTTP, so you can talk to the agent as a logged-in user and read the
 * replies from an outbox. Handy for the API, tests, and web chat.
 */

export interface LocalMessage {
  id: string;
  conversationId: string;
  direction: "in" | "out";
  text: string;
  createdAt: string;
}

export interface LocalChannel extends ChannelAdapter {
  receive(conversationId: string, text: string, userId?: string): Promise<void>;
  messages(conversationId: string): LocalMessage[];
}

export function createLocalChannel(): LocalChannel {
  const handlers: ChannelMessageHandler[] = [];
  const log: LocalMessage[] = [];

  function record(conversationId: string, direction: "in" | "out", text: string): void {
    log.push({
      id: randomUUID(),
      conversationId,
      direction,
      text,
      createdAt: new Date().toISOString(),
    });
  }

  return {
    name: "local",
    onMessage(handler) {
      handlers.push(handler);
    },
    async send(conversationId, text) {
      record(conversationId, "out", text);
    },
    async start() {},
    async stop() {},
    async receive(conversationId, text, userId) {
      record(conversationId, "in", text);
      for (const handler of handlers) {
        handler({ conversationId, text, userId });
      }
    },
    messages(conversationId) {
      return log.filter((message) => message.conversationId === conversationId);
    },
  };
}

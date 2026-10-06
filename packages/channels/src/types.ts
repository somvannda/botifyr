/**
 * Channel contracts. A channel is any place a person can message the agent:
 * a chat app, an API endpoint, or a local console. The cloud routes inbound
 * messages to tasks and sends results back through the same adapter.
 */

export interface ChannelMessage {
  /** Conversation to reply to (a chat id, a user id, ...). */
  conversationId: string;
  text: string;
  /** Who sent it, if the platform exposes an identity. */
  senderId?: string;
  /** Set when the transport already knows the Botifyr user (e.g. authenticated API chat). */
  userId?: string;
}

export type ChannelMessageHandler = (message: ChannelMessage) => void;

export interface ChannelAdapter {
  readonly name: string;
  /** Register the handler that receives inbound messages. */
  onMessage(handler: ChannelMessageHandler): void;
  /** Send a message back to a conversation. */
  send(conversationId: string, text: string): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
}

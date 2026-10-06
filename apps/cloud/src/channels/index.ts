import { createLocalChannel, createTelegramChannel, type LocalChannel } from "@botifyr/channels";
import { ChannelService } from "./service.js";
import type { Store } from "../store/index.js";

export interface ChannelSetup {
  service: ChannelService;
  local: LocalChannel;
}

/**
 * Build the channel set from configuration. The local (authenticated API) chat
 * is always available; Telegram turns on when TELEGRAM_BOT_TOKEN is set.
 */
export function createChannels(store: Store): ChannelSetup {
  const service = new ChannelService(store);

  const local = createLocalChannel();
  service.register(local);

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    service.register(createTelegramChannel({ token: telegramToken }));
  }

  return { service, local };
}

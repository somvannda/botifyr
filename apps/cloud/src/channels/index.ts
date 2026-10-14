import { createLocalChannel, createTelegramChannel, type LocalChannel } from "@botifyr/channels";
import { ChannelService } from "./service.js";
import type { Store } from "../store/index.js";
import { decryptSecret } from "../vault.js";

export interface ChannelSetup {
  service: ChannelService;
  local: LocalChannel;
}

/**
 * Build the channel set from configuration. The local (authenticated API) chat is
 * always available; Telegram turns on when TELEGRAM_BOT_TOKEN is set, and each
 * company's **own** bot (workspace secret + `workspace.telegram`) is registered
 * too — so its inbound messages run as the employee it answers for
 * (docs/external-communications.md §8).
 */
export function createChannels(store: Store, opts: { vaultKey?: Buffer } = {}): ChannelSetup {
  const service = new ChannelService(store);

  const local = createLocalChannel();
  service.register(local);

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  if (telegramToken) {
    service.register(createTelegramChannel({ token: telegramToken }));
  }

  // Company-owned bots are loaded asynchronously; a slow/failed load must not
  // block boot, so it is fire-and-forget.
  void registerWorkspaceBots(store, service, opts.vaultKey).catch(() => {});

  return { service, local };
}

/**
 * Register one Telegram adapter per company that connected its own bot. Returns
 * how many were registered (for tests/logging). Fails closed: no vault key, no
 * token secret, or an undecryptable token → that company is skipped.
 */
export async function registerWorkspaceBots(
  store: Store,
  service: ChannelService,
  vaultKey?: Buffer,
): Promise<number> {
  if (!vaultKey) return 0;
  const workspaces = await store.listWorkspacesWithTelegram().catch(() => []);
  let registered = 0;
  for (const workspace of workspaces) {
    const botId = workspace.telegram?.botId;
    if (!botId) continue;
    const record = await store.getWorkspaceSecret(workspace.id, "TELEGRAM_BOT_TOKEN").catch(() => null);
    if (!record) continue;
    let token = "";
    try {
      token = decryptSecret(vaultKey, record);
    } catch {
      continue;
    }
    if (!token.trim()) continue;
    service.register(createTelegramChannel({ token }), {
      key: `telegram:${workspace.id}`,
      scope: { workspaceId: workspace.id, botId },
    });
    registered += 1;
  }
  return registered;
}

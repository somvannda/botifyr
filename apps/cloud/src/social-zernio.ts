import type { AdsClient } from "./ads-tools.js";
import type { SocialClient } from "./social-tools.js";

/**
 * Zernio adapter (docs/company-workspace.md Part V §44).
 *
 * One workspace API key in front of Facebook, Instagram, Telegram and 15 more
 * platforms — publishing, comments/DMs and analytics — plus Meta/Google/TikTok
 * ads. The workspace brings its own Zernio key (BYO), so Botifyr never holds a
 * Meta app and never passes Meta App Review.
 *
 * API: https://zernio.com/api/v1 (Bearer auth, see https://zernio.com/llms.txt).
 * `fetchImpl` is injectable for tests.
 */

/** One connected Zernio account: a platform and which of its accounts to act on. */
export interface ZernioAccount {
  /** Zernio platform slug: "facebook" | "instagram" | "telegram" | … */
  platform: string;
  /** The connected account id (Zernio `accountId` — never profile + platform). */
  accountId: string;
}

export interface ZernioOptions {
  apiKey: string;
  /** Accounts to publish to. Empty means "discover from GET /v1/accounts". */
  accounts: ZernioAccount[];
  /** Zernio profile id (one profile per end customer). */
  profileId?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

function createZernioApi(options: ZernioOptions) {
  const base = (options.apiBase ?? "https://zernio.com/api/v1").replace(/\/$/, "");
  const doFetch = options.fetchImpl ?? fetch;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Zernio ${response.status}`);
    return (await response.json()) as T;
  }

  return { call };
}

/** Zernio list responses are either `T[]` or `{ <key>: T[] }`. */
function list<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const value = (data as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

/**
 * The accounts to act on: the ones passed in, else discovered from
 * `GET /v1/accounts` (a stored connection holds only the API key). Memoized, so
 * a publish only asks once.
 */
function createAccountResolver(
  call: <T>(method: string, path: string, body?: unknown) => Promise<T>,
  options: ZernioOptions,
): () => Promise<ZernioAccount[]> {
  let cache: ZernioAccount[] | null = null;
  return async () => {
    if (options.accounts.length > 0) return options.accounts;
    if (cache) return cache;
    const query = options.profileId ? `?profileId=${encodeURIComponent(options.profileId)}` : "";
    const data = await call<unknown>("GET", `/accounts${query}`);
    cache = list<{ platform?: string; _id?: string; id?: string }>(data, "accounts")
      .map((account) => ({
        platform: String(account.platform ?? ""),
        accountId: String(account._id ?? account.id ?? ""),
      }))
      .filter((account) => account.platform !== "" && account.accountId !== "");
    return cache;
  };
}

export function createZernioSocialClient(options: ZernioOptions): SocialClient {
  const { call } = createZernioApi(options);
  const resolveAccounts = createAccountResolver(call, options);

  return {
    provider: "Zernio",
    async readInsights() {
      const data = await call<unknown>("GET", "/posts?limit=5");
      const posts = list<{ status?: string; platforms?: Array<{ platform?: string }> }>(data, "posts");
      if (posts.length === 0) return "Zernio: no recent posts.";
      return posts
        .map((post) => {
          const where = (post.platforms ?? [])
            .map((entry) => entry.platform)
            .filter(Boolean)
            .join("/");
          return `- ${post.status ?? "?"}${where ? ` on ${where}` : ""}`;
        })
        .join("\n");
    },
    async publish(text) {
      const accounts = await resolveAccounts();
      if (accounts.length === 0) throw new Error("Zernio: no accounts connected.");
      await call("POST", "/posts", {
        content: text,
        platforms: accounts,
        publishNow: true,
        ...(options.profileId ? { profileId: options.profileId } : {}),
      });
      return `Posted to Zernio (${accounts.map((account) => account.platform).join(", ")}).`;
    },
    async reply(threadId, text) {
      await call("POST", `/inbox/conversations/${encodeURIComponent(threadId)}/messages`, { text });
      return `Replied in Zernio conversation ${threadId}.`;
    },
  };
}

export function createZernioAdsClient(options: ZernioOptions): AdsClient {
  const { call } = createZernioApi(options);

  return {
    provider: "Zernio Ads",
    async readCampaigns() {
      const data = await call<unknown>("GET", "/ads/campaigns");
      const campaigns = list<{ id?: string; name?: string; status?: string }>(data, "campaigns");
      if (campaigns.length === 0) return "No Zernio ad campaigns.";
      return campaigns
        .map((campaign) => `- ${campaign.name ?? campaign.id} — ${campaign.status ?? "?"}`)
        .join("\n");
    },
    async manage({ campaignId, action, dailyCents }) {
      if (action === "budget") {
        // Zernio budgets are whole currency units, not cents — divide, never pass
        // cents through (the 100×-over-spend class of bug).
        const dailyBudget = Math.max(1, Math.round((dailyCents ?? 0) / 100));
        await call("PUT", `/ads/${encodeURIComponent(campaignId)}`, { dailyBudget });
        return `Set ${campaignId} daily budget to ${dailyBudget}.`;
      }
      const status = action === "resume" ? "ACTIVE" : "PAUSED";
      await call("PUT", `/ads/${encodeURIComponent(campaignId)}/status`, { status });
      return `${action === "resume" ? "Resumed" : "Paused"} ${campaignId}.`;
    },
  };
}

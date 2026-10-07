import type { AdsClient } from "./ads-tools.js";

/**
 * Meta (Facebook) Ads client via the Marketing API — the provider behind the ads
 * hand. Reads campaigns and pauses/resumes/changes budgets. `fetchImpl` is
 * injectable for tests. Graph base: https://graph.facebook.com/<version>.
 */
export interface MetaAdsOptions {
  accessToken: string;
  /** Ad account id, e.g. "act_123456". */
  adAccountId: string;
  version?: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

interface Campaign {
  id?: string;
  name?: string;
  status?: string;
  daily_budget?: string;
}

export function createMetaAdsClient(options: MetaAdsOptions): AdsClient {
  const base = `${(options.apiBase ?? "https://graph.facebook.com").replace(/\/$/, "")}/${
    options.version ?? "v21.0"
  }`;
  const doFetch = options.fetchImpl ?? fetch;
  const auth = { authorization: `Bearer ${options.accessToken}` };

  async function get<T>(path: string): Promise<T> {
    const response = await doFetch(`${base}${path}`, { headers: auth });
    if (!response.ok) throw new Error(`Meta ${response.status}`);
    return (await response.json()) as T;
  }
  async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await doFetch(`${base}${path}`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Meta ${response.status}`);
    return (await response.json()) as T;
  }

  return {
    provider: "Meta Ads",
    async readCampaigns() {
      const data = await get<{ data?: Campaign[] }>(
        `/${options.adAccountId}/campaigns?fields=name,status,daily_budget&limit=25`,
      );
      const campaigns = data.data ?? [];
      if (campaigns.length === 0) return "No campaigns on this ad account.";
      return campaigns
        .map(
          (campaign) =>
            `- ${campaign.name ?? campaign.id} — ${campaign.status ?? "?"} — $${(
              (Number(campaign.daily_budget) || 0) / 100
            ).toFixed(2)}/day`,
        )
        .join("\n");
    },
    async manage({ campaignId, action, dailyCents }) {
      if (action === "budget") {
        const cents = Math.max(100, Math.round(dailyCents ?? 0));
        await post(`/${campaignId}`, { daily_budget: cents });
        return `Set ${campaignId} daily budget to $${(cents / 100).toFixed(2)}.`;
      }
      await post(`/${campaignId}`, { status: action === "resume" ? "ACTIVE" : "PAUSED" });
      return `${action === "resume" ? "Resumed" : "Paused"} ${campaignId}.`;
    },
  };
}

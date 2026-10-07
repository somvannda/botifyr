import type { SocialClient } from "./social-tools.js";

/**
 * Postiz aggregator adapter (docs/company-workspace.md Part V §44): a SocialClient
 * backed by the Postiz public API, so FB/IG/LinkedIn/X etc. go through one API
 * (Postiz Cloud holds the platform approvals; self-hosted uses your own apps).
 * `fetchImpl` is injectable for tests.
 * API: https://docs.postiz.com/public-api — base https://api.postiz.com/public/v1,
 * raw `Authorization: <api-key>`.
 */

export interface PostizOptions {
  apiKey: string;
  /** The connected channel (Postiz "integration") id to post to. */
  integrationId: string;
  /** Platform `__type`, e.g. "facebook", "linkedin", "linkedin-page", "x". */
  platform: string;
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

interface Integration {
  id?: string;
  name?: string;
  providerIdentifier?: string;
  disabled?: boolean;
}

export function createPostizSocialClient(options: PostizOptions): SocialClient {
  const api = (options.apiBase ?? "https://api.postiz.com/public/v1").replace(/\/$/, "");
  const doFetch = options.fetchImpl ?? fetch;

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await doFetch(`${api}${path}`, {
      ...init,
      headers: { authorization: options.apiKey, ...(init?.headers ?? {}) },
    });
    if (!response.ok) throw new Error(`Postiz ${response.status}`);
    return (await response.json()) as T;
  }

  return {
    provider: `Postiz (${options.platform})`,
    async readInsights() {
      const integrations = await call<Integration[]>("/integrations");
      const match = Array.isArray(integrations)
        ? integrations.find((entry) => entry.id === options.integrationId)
        : undefined;
      return match
        ? `Postiz channel "${match.name ?? options.integrationId}" (${match.providerIdentifier ?? options.platform})${match.disabled ? " — disabled" : ""}.`
        : "Postiz channel not found — check the integration id.";
    },
    async publish(text) {
      await call("/posts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          type: "now",
          date: new Date().toISOString(),
          shortLink: false,
          tags: [],
          posts: [
            {
              integration: { id: options.integrationId },
              value: [{ content: text, image: [] }],
              settings: { __type: options.platform },
            },
          ],
        }),
      });
      return `Posted via Postiz to ${options.platform}.`;
    },
    async reply() {
      return "Postiz schedules posts but can't reply to comments — use the browser for replies.";
    },
  };
}

import type { SocialClient } from "./social-tools.js";

/**
 * Post for Me adapter (docs/company-workspace.md Part V §44).
 *
 * A cheap publishing API in front of 9 platforms (Facebook, Instagram, Threads,
 * X, LinkedIn, TikTok, Pinterest, Bluesky, YouTube). Publishing only — no
 * comments, inbox, Telegram or ads — so `reply` explains the gap instead of
 * pretending. Use Zernio or SocialAPI when a role needs those capabilities.
 *
 * API: https://api.postforme.dev/v1 (Bearer auth, https://www.postforme.dev).
 * `fetchImpl` is injectable for tests.
 */
export interface PostForMeOptions {
  apiKey: string;
  /** Connected social-account ids to publish to. Empty means "discover from GET /social-accounts". */
  accountIds: string[];
  apiBase?: string;
  fetchImpl?: typeof fetch;
}

/** Post for Me list responses are either `T[]` or `{ data: T[] }`. */
function list<T>(data: unknown, key: string): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && typeof data === "object") {
    const value = (data as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value as T[];
  }
  return [];
}

/**
 * The account ids to publish to: the ones passed in, else discovered from
 * `GET /social-accounts` (a stored connection holds only the API key). Memoized.
 */
function createAccountIdResolver(
  call: <T>(method: string, path: string, body?: unknown) => Promise<T>,
  options: PostForMeOptions,
): () => Promise<string[]> {
  let cache: string[] | null = null;
  return async () => {
    if (options.accountIds.length > 0) return options.accountIds;
    if (cache) return cache;
    const data = await call<unknown>("GET", "/social-accounts");
    cache = list<{ id?: string }>(data, "data")
      .map((account) => String(account.id ?? ""))
      .filter((id) => id !== "");
    return cache;
  };
}

export function createPostForMeSocialClient(options: PostForMeOptions): SocialClient {
  const base = (options.apiBase ?? "https://api.postforme.dev/v1").replace(/\/$/, "");
  const doFetch = options.fetchImpl ?? fetch;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await doFetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Post for Me ${response.status}`);
    return (await response.json()) as T;
  }

  const resolveAccountIds = createAccountIdResolver(call, options);

  return {
    provider: "Post for Me",
    async readInsights() {
      const data = await call<unknown>("GET", "/social-posts");
      const posts = list<{ status?: string; caption?: string }>(data, "data");
      if (posts.length === 0) return "Post for Me: no recent posts.";
      return posts
        .map((post) => {
          const caption = post.caption ? `: ${post.caption.slice(0, 60)}` : "";
          return `- ${post.status ?? "?"}${caption}`;
        })
        .join("\n");
    },
    async publish(text) {
      const accountIds = await resolveAccountIds();
      if (accountIds.length === 0) throw new Error("Post for Me: no accounts connected.");
      await call("POST", "/social-posts", {
        caption: text,
        social_accounts: accountIds,
      });
      return `Posted via Post for Me to ${accountIds.length} account(s).`;
    },
    async reply() {
      return "Post for Me publishes posts but can't reply to comments or DMs — connect Zernio or SocialAPI for inbox.";
    },
  };
}

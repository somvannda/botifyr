import type { ConnectionValidation } from "@botifyr/shared";

/**
 * Validate a token app's credential with the provider before storing it (and to
 * show a connected detail). Each probe is a cheap "who am I / is this key
 * valid" call. Providers without a probe return `ok` with a clear message —
 * we never block a connection we can't check.
 */

const CAMXORA_BASE = (process.env.BOTIFYR_CAMXORA_URL ?? "https://musicapi.camxora.com").replace(/\/+$/, "");

const asJson = async (res: Response): Promise<Record<string, unknown>> =>
  ((await res.json().catch(() => ({}))) as Record<string, unknown>) ?? {};

export async function validateConnection(provider: string, token: string): Promise<ConnectionValidation> {
  try {
    switch (provider) {
      case "camxora": {
        const res = await fetch(`${CAMXORA_BASE}/v1/credits`, {
          headers: { authorization: `Bearer ${token}` },
        });
        if (res.status === 401 || res.status === 403) return { ok: false, message: "Invalid API key." };
        if (!res.ok) return { ok: false, message: `Camxora error ${res.status}.` };
        const data = await asJson(res);
        const nested = (data.data ?? {}) as Record<string, unknown>;
        const credits = (data.credits ?? nested.credits) as number | undefined;
        return {
          ok: true,
          message: typeof credits === "number" ? `Valid — ${credits} credits` : "Valid API key",
        };
      }
      case "github": {
        const res = await fetch("https://api.github.com/user", {
          headers: {
            authorization: `Bearer ${token}`,
            accept: "application/vnd.github+json",
            "user-agent": "botifyr",
          },
        });
        if (res.status === 401) return { ok: false, message: "Invalid token." };
        if (!res.ok) return { ok: false, message: `GitHub error ${res.status}.` };
        const data = await asJson(res);
        return { ok: true, message: data.login ? `Signed in as @${data.login}` : "Valid token" };
      }
      case "telegram": {
        const res = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = await asJson(res);
        if (!data.ok) return { ok: false, message: String(data.description ?? "Invalid bot token.") };
        const result = (data.result ?? {}) as { username?: string; first_name?: string };
        const name = result.username ? `@${result.username}` : result.first_name;
        return { ok: true, message: name ? `Bot ${name}` : "Valid bot token" };
      }
      case "notion": {
        const res = await fetch("https://api.notion.com/v1/users/me", {
          headers: { authorization: `Bearer ${token}`, "notion-version": "2022-06-28" },
        });
        if (res.status === 401) return { ok: false, message: "Invalid token." };
        if (!res.ok) return { ok: false, message: `Notion error ${res.status}.` };
        const data = await asJson(res);
        const bot = (data.bot ?? {}) as { workspace_name?: string };
        const where = bot.workspace_name ?? (data.name as string | undefined);
        return { ok: true, message: where ? `Connected to ${where}` : "Valid token" };
      }
      case "slack": {
        const res = await fetch("https://slack.com/api/auth.test", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
        });
        const data = await asJson(res);
        if (!data.ok) return { ok: false, message: data.error ? `Slack: ${data.error}` : "Invalid token." };
        return { ok: true, message: data.team ? `Connected to ${data.team}` : "Valid token" };
      }
      case "zernio": {
        const res = await fetch("https://zernio.com/api/v1/accounts", {
          headers: { authorization: `Bearer ${token}` },
        });
        if (res.status === 401 || res.status === 403) return { ok: false, message: "Invalid API key." };
        if (!res.ok) return { ok: false, message: `Zernio error ${res.status}.` };
        const accounts = (await asJson(res)).accounts ?? [];
        return {
          ok: true,
          message: Array.isArray(accounts) ? `Valid — ${accounts.length} account(s)` : "Valid API key",
        };
      }
      case "postforme": {
        const res = await fetch("https://api.postforme.dev/v1/social-accounts", {
          headers: { authorization: `Bearer ${token}` },
        });
        if (res.status === 401 || res.status === 403) return { ok: false, message: "Invalid API key." };
        if (!res.ok) return { ok: false, message: `Post for Me error ${res.status}.` };
        const accounts = (await asJson(res)).data ?? [];
        return {
          ok: true,
          message: Array.isArray(accounts) ? `Valid — ${accounts.length} account(s)` : "Valid API key",
        };
      }
      case "publora": {
        const res = await fetch("https://api.publora.com/api/v1/platform-connections", {
          headers: { "x-publora-key": token },
        });
        if (res.status === 401 || res.status === 403) return { ok: false, message: "Invalid API key." };
        if (!res.ok) return { ok: false, message: `Publora error ${res.status}.` };
        const connections = (await asJson(res)).connections ?? [];
        return {
          ok: true,
          message: Array.isArray(connections)
            ? `Valid — ${connections.length} connection(s)`
            : "Valid API key",
        };
      }
      default:
        return { ok: true, message: "Connected (this app can't be auto-checked)." };
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Validation failed." };
  }
}

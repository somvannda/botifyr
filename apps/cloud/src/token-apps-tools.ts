import type { ToolDefinition } from "@botifyr/agent-core";
import { connectionToken } from "./connections-tools.js";
import type { Store } from "./store/index.js";

/* Slack -------------------------------------------------------------------- */
export function createSlackTools(store: Store, vaultKey: Buffer, userId: string): ToolDefinition[] {
  return [
    {
      name: "slack.list_channels",
      description: "List Slack channels the connected token can see.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const token = await connectionToken(store, vaultKey, userId, "slack");
        if (!token) return { ok: false, output: "Slack isn't connected. Connect it in the Marketplace." };
        const response = await fetch(
          "https://slack.com/api/conversations.list?limit=20&types=public_channel,private_channel",
          { headers: { authorization: `Bearer ${token}` } },
        );
        const data = (await response.json()) as {
          ok: boolean;
          error?: string;
          channels?: Array<{ id: string; name: string }>;
        };
        if (!data.ok) return { ok: false, output: `Slack error: ${data.error ?? "unknown"}` };
        const rows = (data.channels ?? []).map((channel) => `- #${channel.name} (${channel.id})`);
        return { ok: true, output: rows.length ? rows.join("\n") : "No channels." };
      },
    },
    {
      name: "slack.post_message",
      description: "Post a message to a Slack channel (id or name).",
      parameters: {
        type: "object",
        properties: { channel: { type: "string" }, text: { type: "string" } },
        required: ["channel", "text"],
      },
      requiresApproval: true,
      run: async (args) => {
        const token = await connectionToken(store, vaultKey, userId, "slack");
        if (!token) return { ok: false, output: "Slack isn't connected. Connect it in the Marketplace." };
        const response = await fetch("https://slack.com/api/chat.postMessage", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ channel: String(args.channel ?? ""), text: String(args.text ?? "") }),
        });
        const data = (await response.json()) as { ok: boolean; error?: string };
        return data.ok
          ? { ok: true, output: "Message sent." }
          : { ok: false, output: `Slack error: ${data.error ?? "unknown"}` };
      },
    },
  ];
}

/* Telegram ----------------------------------------------------------------- */
export function createTelegramTools(store: Store, vaultKey: Buffer, userId: string): ToolDefinition[] {
  return [
    {
      name: "telegram.get_me",
      description: "Check the connected Telegram bot (username / name).",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const token = await connectionToken(store, vaultKey, userId, "telegram");
        if (!token) return { ok: false, output: "Telegram isn't connected. Connect it in the Marketplace." };
        const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
        const data = (await response.json()) as {
          ok: boolean;
          description?: string;
          result?: { username?: string; first_name?: string };
        };
        return data.ok
          ? { ok: true, output: `Bot: @${data.result?.username ?? "?"} (${data.result?.first_name ?? ""})` }
          : { ok: false, output: `Telegram error: ${data.description ?? response.status}` };
      },
    },
    {
      name: "telegram.send_message",
      description: "Send a Telegram message to a chat id or @channel.",
      parameters: {
        type: "object",
        properties: { chat_id: { type: "string" }, text: { type: "string" } },
        required: ["chat_id", "text"],
      },
      requiresApproval: true,
      run: async (args) => {
        const token = await connectionToken(store, vaultKey, userId, "telegram");
        if (!token) return { ok: false, output: "Telegram isn't connected. Connect it in the Marketplace." };
        const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chat_id: String(args.chat_id ?? ""), text: String(args.text ?? "") }),
        });
        const data = (await response.json()) as { ok: boolean; description?: string };
        return data.ok
          ? { ok: true, output: "Message sent." }
          : { ok: false, output: `Telegram error: ${data.description ?? response.status}` };
      },
    },
  ];
}

/* Notion ------------------------------------------------------------------- */
export function createNotionTools(store: Store, vaultKey: Buffer, userId: string): ToolDefinition[] {
  const headers = (token: string) => ({
    authorization: `Bearer ${token}`,
    "notion-version": "2022-06-28",
    "content-type": "application/json",
  });

  return [
    {
      name: "notion.search",
      description: "Search the user's Notion pages and databases.",
      parameters: { type: "object", properties: { query: { type: "string" } } },
      run: async (args) => {
        const token = await connectionToken(store, vaultKey, userId, "notion");
        if (!token) return { ok: false, output: "Notion isn't connected. Connect it in the Marketplace." };
        const response = await fetch("https://api.notion.com/v1/search", {
          method: "POST",
          headers: headers(token),
          body: JSON.stringify({ page_size: 10, query: String(args.query ?? "") }),
        });
        const data = (await response.json()) as {
          message?: string;
          results?: Array<{
            object: string;
            id: string;
            title?: Array<{ plain_text: string }>;
            properties?: Record<string, { title?: Array<{ plain_text: string }> }>;
          }>;
        };
        if (!response.ok) return { ok: false, output: `Notion error: ${data.message ?? response.status}` };
        const rows = (data.results ?? []).map((result) => {
          const title =
            result.object === "database"
              ? (result.title?.[0]?.plain_text ?? "Untitled")
              : (result.properties?.title?.title?.[0]?.plain_text ??
                result.properties?.Name?.title?.[0]?.plain_text ??
                "Untitled");
          return `- ${result.object}: ${title} (${result.id})`;
        });
        return { ok: true, output: rows.length ? rows.join("\n") : "No results." };
      },
    },
    {
      name: "notion.read_page",
      description: "Read a Notion page's text by page id.",
      parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      run: async (args) => {
        const token = await connectionToken(store, vaultKey, userId, "notion");
        if (!token) return { ok: false, output: "Notion isn't connected. Connect it in the Marketplace." };
        const response = await fetch(
          `https://api.notion.com/v1/blocks/${String(args.id ?? "")}/children?page_size=50`,
          { headers: headers(token) },
        );
        const data = (await response.json()) as {
          message?: string;
          results?: Array<Record<string, { rich_text?: Array<{ plain_text: string }> }>>;
        };
        if (!response.ok) return { ok: false, output: `Notion error: ${data.message ?? response.status}` };
        const text = (data.results ?? [])
          .map((block) => {
            const value = block[String(block.type)] as
              { rich_text?: Array<{ plain_text: string }> } | undefined;
            return (value?.rich_text ?? []).map((part) => part.plain_text).join("");
          })
          .filter(Boolean)
          .join("\n");
        return { ok: true, output: text || "(no text)" };
      },
    },
  ];
}

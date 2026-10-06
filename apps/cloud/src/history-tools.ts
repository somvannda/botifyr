import type { ToolDefinition } from "@botifyr/agent-core";
import type { Store } from "./store/index.js";

/**
 * Let a bot search its own past conversations on demand — both its separate
 * one-to-one chat with the user and the current thread. This is how it finds
 * things the user shared earlier (e.g. links) that fall outside the context
 * window.
 */
export function createHistoryTools(store: Store, botId: string | null, sessionId: string): ToolDefinition[] {
  return [
    {
      name: "history.search",
      description:
        "Search your own past conversations (your separate one-to-one chat with the user AND this thread) for a word or phrase — e.g. to find links or details the user shared earlier.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Word or phrase to find." } },
        required: ["query"],
      },
      run: async (args) => {
        const query = String(args.query ?? "")
          .trim()
          .toLowerCase();
        if (!query) return { ok: false, output: "A search query is required." };
        const sources: Array<{ label: string; id: string }> = [];
        if (botId) {
          const bot = await store.getBot(botId);
          if (bot) sources.push({ label: "your own chat with the user", id: bot.sessionId });
        }
        sources.push({ label: "this thread", id: sessionId });

        const seen = new Set<string>();
        const results: string[] = [];
        for (const source of sources) {
          const session = await store.getSession(source.id);
          if (!session) continue;
          for (const message of session.messages) {
            if (seen.has(message.id)) continue;
            if (!message.content.toLowerCase().includes(query)) continue;
            seen.add(message.id);
            const speaker = message.role === "user" ? "User" : "You";
            results.push(`[${source.label}] ${speaker}: ${message.content.slice(0, 500)}`);
          }
        }
        return {
          ok: true,
          output: results.length
            ? results.slice(-20).join("\n")
            : `No matches for "${args.query}" in your history.`,
        };
      },
    },
  ];
}

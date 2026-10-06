import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@botifyr/agent-core";
import type { Store } from "./store/index.js";

/**
 * Agent tools for the bot's Library: text files the bot keeps between runs
 * (notes, drafts, artifacts). Scoped to the authoring bot.
 */
export function createFileTools(store: Store, botId: string, userId: string): ToolDefinition[] {
  return [
    {
      name: "library.list",
      description: "List the files in this bot's Library.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const files = await store.listFiles(botId);
        return {
          ok: true,
          output: files.length
            ? files.map((file) => `- ${file.name} (${file.content.length} chars)`).join("\n")
            : "The Library is empty.",
        };
      },
    },
    {
      name: "library.read",
      description: "Read a file from this bot's Library by name.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "File name." } },
        required: ["name"],
      },
      run: async (args) => {
        const name = String(args.name ?? "");
        const file = (await store.listFiles(botId)).find((entry) => entry.name === name);
        return file ? { ok: true, output: file.content } : { ok: false, output: `No file named "${name}".` };
      },
    },
    {
      name: "library.write",
      description: "Create or replace a text file in this bot's Library.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "File name, e.g. notes.md" },
          content: { type: "string", description: "File contents." },
        },
        required: ["name", "content"],
      },
      run: async (args) => {
        const name = String(args.name ?? "")
          .trim()
          .slice(0, 120);
        if (!name) return { ok: false, output: "A file name is required." };
        const content = String(args.content ?? "").slice(0, 200_000);
        const existing = (await store.listFiles(botId)).find((entry) => entry.name === name);
        const now = new Date().toISOString();
        await store.upsertFile({
          id: existing?.id ?? randomUUID(),
          botId,
          userId,
          name,
          content,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        return { ok: true, output: `Saved "${name}" (${content.length} chars).` };
      },
    },
  ];
}

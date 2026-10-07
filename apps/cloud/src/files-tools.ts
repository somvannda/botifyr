import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@botifyr/agent-core";
import type { FileRecord } from "./store/types.js";
import type { Store } from "./store/index.js";

/**
 * Agent tools for the bot's Library: text files the bot keeps between runs
 * (notes, drafts, artifacts). For a bot in a company the Library also spans the
 * company wiki (BRIEF / OKRS / BACKLOG / PLAN / CODEBASE), so teammates can
 * read each other's plans; writes go to the shared wiki.
 */
export function createFileTools(store: Store, botId: string, userId: string): ToolDefinition[] {
  /** Tolerate the field names models commonly use for a file name. */
  const resolveName = (args: Record<string, unknown>): string => {
    const raw = args.name ?? args.filename ?? args.file ?? args.path ?? args.title;
    return String(raw ?? "")
      .trim()
      .replace(/^.*[\\/]/, "")
      .slice(0, 120);
  };

  /** The bot's company workspace id, if it belongs to one. */
  const companyWorkspaceId = async (): Promise<string | undefined> => {
    const bot = await store.getBot(botId).catch(() => null);
    if (!bot?.workspace) return undefined;
    const workspaces = await store.listWorkspaces(userId).catch(() => []);
    return workspaces.find((entry) => entry.name === bot.workspace)?.id;
  };

  /** Personal files + the company wiki, merged by name (personal wins). */
  const allFiles = async (): Promise<FileRecord[]> => {
    const personal = await store.listFiles(botId);
    const workspaceId = await companyWorkspaceId();
    if (!workspaceId) return personal;
    const wiki = await store.listWorkspaceFiles(workspaceId).catch(() => []);
    const byName = new Map<string, FileRecord>();
    for (const file of personal) byName.set(file.name, file);
    for (const file of wiki) if (!byName.has(file.name)) byName.set(file.name, file);
    return [...byName.values()];
  };

  return [
    {
      name: "library.list",
      description: "List the files in this bot's Library (including the company wiki).",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const files = await allFiles();
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
      description: "Read a file from this bot's Library or the company wiki by name.",
      parameters: {
        type: "object",
        properties: { name: { type: "string", description: "File name." } },
        required: ["name"],
      },
      run: async (args) => {
        const name = resolveName(args);
        const file = (await allFiles()).find((entry) => entry.name === name);
        return file ? { ok: true, output: file.content } : { ok: false, output: `No file named "${name}".` };
      },
    },
    {
      name: "library.write",
      description: "Create or replace a text file (company bots write to the shared wiki).",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "File name, e.g. notes.md" },
          content: { type: "string", description: "File contents." },
        },
        required: ["name", "content"],
      },
      run: async (args) => {
        const name = resolveName(args);
        if (!name) {
          return {
            ok: false,
            output: 'A file name is required, e.g. {"name":"notes.md","content":"..."}.',
          };
        }
        const content = String(args.content ?? "").slice(0, 200_000);
        const now = new Date().toISOString();
        const workspaceId = await companyWorkspaceId();
        if (workspaceId) {
          const existing = (await store.listWorkspaceFiles(workspaceId)).find((entry) => entry.name === name);
          await store.upsertFile({
            id: existing?.id ?? randomUUID(),
            botId: existing?.botId ?? botId,
            userId,
            workspaceId,
            name,
            content,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          });
          return { ok: true, output: `Saved "${name}" to the company wiki (${content.length} chars).` };
        }
        const existing = (await store.listFiles(botId)).find((entry) => entry.name === name);
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

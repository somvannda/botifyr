import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@botifyr/agent-core";
import type { Bot } from "@botifyr/shared";
import type { Store } from "./store/index.js";
import { rememberSession } from "./runtime.js";
import { emit } from "./events.js";
import { toDepartment } from "./company.js";

/**
 * Hiring: let the CEO (or a company's exec) add an employee by chatting —
 * "hire a Head of Growth". Approval-gated (creating an employee is
 * consequential). docs/company-workspace.md §16 (hire_employee) & §17.
 */
export function createHireTools(store: Store, userId: string, botId: string): ToolDefinition[] {
  return [
    {
      name: "company.hire",
      description:
        "Hire a new employee into the company by role title (e.g. \"Head of Growth\", \"QA Engineer\"), with optional department and instructions. Needs the owner's approval.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The role title." },
          department: { type: "string", description: "Department (e.g. engineering, growth, sales)." },
          instructions: { type: "string", description: "Job description / standing instructions." },
        },
        required: ["title"],
      },
      requiresApproval: true,
      run: async (args) => {
        const author = await store.getBot(botId);
        if (!author?.workspace) return { ok: false, output: "This bot is not part of a company." };
        const workspace = (await store.listWorkspaces(userId)).find(
          (entry) => entry.name === author.workspace,
        );
        if (!workspace) return { ok: false, output: "Company not found." };

        const title = String(args.title ?? "")
          .trim()
          .slice(0, 40);
        if (!title) return { ok: false, output: "A role title is required." };
        const department = toDepartment(args.department);
        const instructions = String(args.instructions ?? "")
          .trim()
          .slice(0, 4000);

        const now = new Date().toISOString();
        const session = {
          id: randomUUID(),
          userId,
          title,
          messages: [],
          createdAt: now,
          botId: undefined as string | undefined,
        };
        const bot: Bot = {
          id: randomUUID(),
          userId,
          name: title,
          emoji: "🤖",
          scheme: 0,
          instructions,
          workspace: workspace.name,
          sessionId: session.id,
          createdAt: now,
        };
        session.botId = bot.id;
        await store.createSession(session);
        await store.createBot(bot);
        rememberSession(session.id, userId);
        emit({ type: "session.created", session });
        await store.setBotRole({
          workspaceId: workspace.id,
          botId: bot.id,
          title,
          department,
          hiredAt: now,
        });
        return { ok: true, output: `Hired ${title} (${department}).` };
      },
    },
  ];
}

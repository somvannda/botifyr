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
        "Hire a new employee. Give their role title (e.g. \"Head of Growth\") AND invent a realistic, unique full name — do not reuse a name already on the team. Match the company's local market (e.g. Cambodian names like \"Sokha Chan\" or \"Dara Sok\" for a Cambodia-based business); if the CEO asks for a specific style or region, follow that. Needs the owner's approval.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The role title, e.g. \"Head of Growth\"." },
          name: {
            type: "string",
            description:
              "A realistic full name you choose, matching the company's local market (e.g. Cambodian names for a Cambodia business).",
          },
          department: { type: "string", description: "Department (e.g. engineering, growth, sales)." },
          instructions: { type: "string", description: "Job description / standing instructions." },
          company: { type: "string", description: "Company name (optional when you have one company)." },
        },
        required: ["title", "name"],
      },
      requiresApproval: true,
      run: async (args) => {
        const author = await store.getBot(botId);
        const workspaces = await store.listWorkspaces(userId);
        const requested = String(args.company ?? "")
          .trim()
          .toLowerCase();
        const workspace =
          (author?.workspace
            ? workspaces.find((entry) => entry.name === author.workspace)
            : undefined) ??
          (requested
            ? workspaces.find((entry) => entry.name.toLowerCase() === requested)
            : workspaces.length === 1
              ? workspaces[0]
              : undefined);
        if (!workspace) {
          return {
            ok: false,
            output:
              workspaces.length === 0
                ? "You don't have a company yet — create one first."
                : `Which company? ${workspaces.map((entry) => entry.name).join(", ")}.`,
          };
        }

        const title = String(args.title ?? "")
          .trim()
          .slice(0, 40);
        if (!title) return { ok: false, output: "A role title is required." };
        const existingRoles = await store.listBotRoles(workspace.id);
        if (existingRoles.some((role) => role.title.toLowerCase() === title.toLowerCase())) {
          return {
            ok: false,
            output: `There's already a "${title}" — fire them first, or hire a different role.`,
          };
        }
        const department = toDepartment(args.department);
        const instructions = String(args.instructions ?? "")
          .trim()
          .slice(0, 4000);
        // Give the hire a personal name, not their role title.
        const name = String(args.name ?? "")
          .trim()
          .slice(0, 40);
        if (!name) {
          return {
            ok: false,
            output: 'A name is required — give the new hire a realistic full name (e.g. "Alex Rivera").',
          };
        }

        const now = new Date().toISOString();
        const session = {
          id: randomUUID(),
          userId,
          title: name,
          messages: [],
          createdAt: now,
          botId: undefined as string | undefined,
        };
        const bot: Bot = {
          id: randomUUID(),
          userId,
          name,
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
        return { ok: true, output: `Hired ${name} as ${title} (${department}).` };
      },
    },
  ];
}

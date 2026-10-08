import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@botifyr/agent-core";
import type { WorkItem } from "@botifyr/shared";
import type { Store } from "./store/index.js";

/**
 * Delegation: a manager assigns work to a teammate by role (docs/company-os.md
 * §18). The assignment lands on the company board as a work item, owned by the
 * matching employee. Exposed to a bot that belongs to a company.
 */
export function createDelegationTools(store: Store, userId: string, botId: string): ToolDefinition[] {
  const PHASES = ["mvp", "phase2", "phase3", "ongoing"];
  return [
    {
      name: "company.delegate",
      description:
        "Assign a task on a company board to an employee, by role title (e.g. \"CTO\", \"Head of Growth\"). Works for the company you own; pass `company` if you have more than one.",
      parameters: {
        type: "object",
        properties: {
          role: { type: "string", description: "The employee's role title or department, e.g. \"CTO\"." },
          task: { type: "string", description: "What to assign." },
          phase: { type: "string", enum: PHASES, description: "Which backlog phase." },
          company: { type: "string", description: "Company name (optional when you have one company)." },
        },
        required: ["role", "task"],
      },
      run: async (args) => {
        const author = await store.getBot(botId);
        const workspaces = await store.listWorkspaces(userId);
        const requested = String(args.company ?? "")
          .trim()
          .toLowerCase();
        // Prefer the bot's own company; otherwise the company you own (or the
        // one you named). This lets the CEO's Founder bot delegate.
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

        const role = String(args.role ?? "")
          .trim()
          .toLowerCase();
        if (!role) return { ok: false, output: "A role is required." };
        const roles = await store.listBotRoles(workspace.id);
        const match = roles.find(
          (entry) =>
            entry.title.toLowerCase().includes(role) || entry.department.toLowerCase() === role,
        );
        if (!match) {
          return { ok: false, output: `No employee matches "${args.role}". Team: ${roles.map((r) => r.title).join(", ")}.` };
        }

        const title = String(args.task ?? "")
          .trim()
          .slice(0, 200);
        if (!title) return { ok: false, output: "A task is required." };
        const phase = PHASES.includes(String(args.phase)) ? (args.phase as WorkItem["phase"]) : "ongoing";
        const now = new Date().toISOString();
        // Dedupe: never stack the same task twice on the board.
        const existing = await store.listWorkItems(workspace.id);
        const duplicate = existing.find(
          (item) => item.status !== "done" && item.title.trim().toLowerCase() === title.toLowerCase(),
        );
        if (duplicate) {
          return { ok: true, output: `Already on the board: "${title}" (${duplicate.status}).` };
        }
        await store.createWorkItem({
          id: randomUUID(),
          workspaceId: workspace.id,
          title,
          phase,
          status: "todo",
          assigneeBotId: match.botId,
          department: match.department,
          createdBy: botId,
          createdAt: now,
          updatedAt: now,
        });
        return { ok: true, output: `Assigned to ${match.title}: ${title}` };
      },
    },
    {
      name: "company.report",
      description:
        "Record the outcome of a board task you were assigned: mark it done (or blocked/review) and write what it produced — a summary, file name, PR or report. Use the task's title from the board. This is what shows up as \"what shipped\".",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "The board task title (or a distinctive part of it)." },
          result: { type: "string", description: "What the task produced — the deliverable." },
          status: {
            type: "string",
            enum: ["done", "blocked", "review"],
            description: "The new status; defaults to done.",
          },
          company: { type: "string", description: "Company name (optional when you have one company)." },
        },
        required: ["task", "result"],
      },
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
        const needle = String(args.task ?? "")
          .trim()
          .toLowerCase();
        if (!needle) return { ok: false, output: "A task title is required." };
        const result = String(args.result ?? "")
          .trim()
          .slice(0, 4000);
        if (!result) return { ok: false, output: "A result is required — say what the task produced." };
        const allowed = new Set<WorkItem["status"]>(["done", "blocked", "review"]);
        const status: WorkItem["status"] = allowed.has(args.status as WorkItem["status"])
          ? (args.status as WorkItem["status"])
          : "done";

        const items = await store.listWorkItems(workspace.id);
        const mine = items.filter((entry) => entry.assigneeBotId === botId && entry.status !== "done");
        const item =
          mine.find((entry) => entry.title.toLowerCase() === needle) ??
          mine.find((entry) => entry.title.toLowerCase().includes(needle)) ??
          items.find((entry) => entry.status !== "done" && entry.title.toLowerCase().includes(needle));
        if (!item) {
          return { ok: false, output: `No open board task matches "${args.task}".` };
        }
        item.status = status;
        item.result = result;
        item.updatedAt = new Date().toISOString();
        await store.updateWorkItem(item);
        return { ok: true, output: `Recorded "${item.title}" as ${status}: ${result}` };
      },
    },
  ];
}

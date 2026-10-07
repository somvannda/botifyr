import type { ToolDefinition } from "@botifyr/agent-core";
import type { Store } from "./store/index.js";
import { emit } from "./events.js";

/**
 * Firing: the CEO (or a department leader) can remove an employee from the
 * company by role title or name. Approval-gated — removing people is
 * consequential. Deletes the employee's bot, thread and files, plus their role.
 */
export function createFireTools(store: Store, userId: string, botId: string): ToolDefinition[] {
  return [
    {
      name: "company.fire",
      description:
        'Remove (fire) an employee from the company by role title (e.g. "CTO") or name. Needs the owner\'s approval.',
      parameters: {
        type: "object",
        properties: {
          role: { type: "string", description: "Role title or department of the employee to remove." },
          name: { type: "string", description: "The employee's name (alternative to role)." },
          company: { type: "string", description: "Company name (optional when you have one company)." },
        },
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
        if (!workspace) return { ok: false, output: "You don't have a company yet." };

        const roles = await store.listBotRoles(workspace.id);
        const roleQuery = String(args.role ?? "")
          .trim()
          .toLowerCase();
        const nameQuery = String(args.name ?? "")
          .trim()
          .toLowerCase();
        if (!roleQuery && !nameQuery) {
          return { ok: false, output: `Which employee? Team: ${roles.map((role) => role.title).join(", ")}.` };
        }

        let match = roleQuery
          ? (roles.find((role) => role.title.toLowerCase() === roleQuery) ??
            roles.find((role) => role.title.toLowerCase().includes(roleQuery)) ??
            roles.find((role) => role.department.toLowerCase() === roleQuery))
          : undefined;
        if (!match && nameQuery) {
          for (const role of roles) {
            const employee = await store.getBot(role.botId);
            if (employee && employee.name.toLowerCase() === nameQuery) {
              match = role;
              break;
            }
          }
        }
        if (!match) {
          return {
            ok: false,
            output: `No employee matches. Team: ${roles.map((role) => role.title).join(", ")}.`,
          };
        }
        if (match.botId === botId) return { ok: false, output: "You can't fire yourself." };
        if (match.isChair) {
          return { ok: false, output: "The chair can't be fired — make someone else the chair first." };
        }

        const employee = await store.getBot(match.botId);
        if (!employee) return { ok: false, output: "That employee no longer exists." };
        const title = match.title;

        // Cascade: files, thread, bot, then the board role.
        const files = await store.listFiles(employee.id).catch(() => []);
        for (const file of files) await store.deleteFile(userId, file.id).catch(() => false);
        await store.deleteSession(userId, employee.sessionId).catch(() => false);
        await store.deleteBot(userId, employee.id).catch(() => false);
        await store.deleteBotRole(workspace.id, employee.id).catch(() => false);
        // Tell every open client so the roster refreshes without a manual reload.
        emit({ type: "bot.deleted", botId: employee.id, sessionId: employee.sessionId, userId });

        return {
          ok: true,
          output: `Fired ${employee.name} (${title}). ${roles.length - 1} employees remain.`,
        };
      },
    },
  ];
}

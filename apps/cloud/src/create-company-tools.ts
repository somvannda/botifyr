import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@botifyr/agent-core";
import type { Bot } from "@botifyr/shared";
import type { Store } from "./store/index.js";
import { analyzeSource, planCompany, type CompleteFn } from "./company.js";
import { seedCompany } from "./company-seed.js";
import { rememberSession } from "./runtime.js";
import { emit } from "./events.js";

/**
 * "Build a company" from chat: understand a site/idea, design the team, hire
 * everyone, and seed the wiki + board. Offered to a Founder bot (no workspace
 * yet). Approval-gated. docs/company-workspace.md §16 (create_company).
 */
export function createCompanyMakerTools(
  store: Store,
  userId: string,
  complete: CompleteFn,
  fetchText?: (url: string) => Promise<string>,
): ToolDefinition[] {
  return [
    {
      name: "company.create",
      description:
        "Create a whole new company from a website or an idea: understand it, design the team, hire everyone, and seed the wiki and board. Needs the owner's approval.",
      parameters: {
        type: "object",
        properties: {
          value: { type: "string", description: "The website URL or the idea text." },
          kind: { type: "string", enum: ["url", "idea"] },
          name: { type: "string", description: "Optional company name." },
        },
        required: ["value"],
      },
      requiresApproval: true,
      run: async (args) => {
        const value = String(args.value ?? "")
          .trim()
          .slice(0, 1000);
        if (!value) return { ok: false, output: "A website URL or an idea is required." };
        const kind: "url" | "idea" = args.kind === "url" ? "url" : "idea";
        const name = typeof args.name === "string" ? args.name.trim().slice(0, 60) : undefined;

        const { dna } = await analyzeSource({ kind, value }, { complete, fetchText });
        const plan = await planCompany({ kind, value, name, stage: dna.stage }, complete, dna);

        const now = new Date().toISOString();
        const workspace = {
          id: randomUUID(),
          ownerId: userId,
          name: plan.name,
          source: { kind, value: value.slice(0, 500) },
          mission: plan.mission ?? "",
          dna,
          status: "active" as const,
          avatarEmoji: plan.avatarEmoji,
          createdAt: now,
          updatedAt: now,
          ceoBotId: undefined as string | undefined,
        };
        await store.createWorkspace(workspace);

        let chairBotId: string | undefined;
        for (const member of plan.members) {
          const title = member.title.trim().slice(0, 40) || member.name.slice(0, 40);
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
            name: member.name.slice(0, 40) || title,
            emoji: member.emoji ?? "🤖",
            scheme: member.scheme ?? 0,
            instructions: member.instructions ?? "",
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
            department: member.department ?? "ops",
            isChair: member.isChair === true,
            hiredAt: now,
          });
          if (member.isChair === true && !chairBotId) chairBotId = bot.id;
        }

        if (chairBotId) {
          workspace.ceoBotId = chairBotId;
          await store.updateWorkspace(workspace);
          await seedCompany(store, {
            userId,
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            mission: workspace.mission,
            chairBotId,
            dna,
          });
        }

        const team = plan.members.map((member) => member.title).join(", ");
        return {
          ok: true,
          output: `Created "${workspace.name}" with ${plan.members.length} employees: ${team}. Open the app's Company HQ to see it.`,
        };
      },
    },
  ];
}

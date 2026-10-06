import { randomUUID } from "node:crypto";
import type { ToolDefinition } from "@botifyr/agent-core";
import type { Store } from "./store/index.js";

/**
 * Self-learning tools: a bot can research how to do something, then save a
 * reusable guide. Learned skills are GLOBAL — every user's bots see them, so
 * Botifyr gets smarter for everyone over time.
 */
export function createLearnedSkillTools(store: Store, userId: string): ToolDefinition[] {
  return [
    {
      name: "skills.list",
      description: "List the skills the bot team has already learned.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const list = await store.listLearnedSkills();
        const visible = list.filter((skill) => skill.status === "approved" || skill.createdBy === userId);
        return {
          ok: true,
          output: visible.length
            ? visible
                .map(
                  (skill) =>
                    `- ${skill.name}: ${skill.description}${skill.status === "pending" ? " (pending)" : ""}`,
                )
                .join("\n")
            : "No learned skills yet. Research a task and save one with skills.learn.",
        };
      },
    },
    {
      name: "skills.get",
      description: "Read the full guide for a learned skill by name.",
      parameters: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
      run: async (args) => {
        const skill = await store.getLearnedSkillByName(String(args.name ?? ""));
        if (!skill || (skill.status !== "approved" && skill.createdBy !== userId)) {
          return { ok: false, output: `No learned skill named "${args.name}". Use skills.list.` };
        }
        return { ok: true, output: `# ${skill.name}\n${skill.description}\n\n${skill.content}` };
      },
    },
    {
      name: "skills.learn",
      description:
        "Save a skill you figured out so EVERY bot (all users) can reuse it. After researching (browser/shell), write a clear, step-by-step guide with the tools, exact commands, and pitfalls.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short title, e.g. 'Download YouTube video (yt-dlp)'." },
          description: { type: "string", description: "One-line summary." },
          content: { type: "string", description: "Step-by-step guide: tools, commands, gotchas." },
          source: { type: "string", description: "Where you learned it (URLs)." },
        },
        required: ["name", "description", "content"],
      },
      requiresApproval: true,
      run: async (args) => {
        const name = String(args.name ?? "")
          .trim()
          .slice(0, 80);
        if (!name) return { ok: false, output: "A skill name is required." };
        const description = String(args.description ?? "").slice(0, 240);
        const content = String(args.content ?? "").slice(0, 20_000);
        const source = String(args.source ?? "").slice(0, 1_000);
        const existing = await store.getLearnedSkillByName(name);
        const now = new Date().toISOString();
        await store.upsertLearnedSkill({
          id: existing?.id ?? randomUUID(),
          name,
          description,
          content,
          source,
          createdBy: existing?.createdBy ?? userId,
          status: existing?.status ?? "pending",
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        });
        return {
          ok: true,
          output: `Learned skill "${name}" saved (pending review before it's shared with everyone).`,
        };
      },
    },
  ];
}

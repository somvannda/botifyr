import { randomUUID } from "node:crypto";
import type {
  CompanyDNA,
  Department,
  Quest,
  QuestStatus,
  WorkPhase,
  WorkspaceAutonomy,
} from "@botifyr/shared";
import type { Store } from "./store/index.js";

/** The first mission to seed when a company is created (docs/company-quests.md §3.2). */
export interface SeedQuestInput {
  title?: string;
  objective?: string;
  acceptance?: string[];
  directionId?: string;
  stage?: CompanyDNA["stage"];
  trust?: WorkspaceAutonomy;
  roadmap?: Array<{ phase: WorkPhase; title: string }>;
  /** Default "active"; use "proposed" for a quest awaiting the CEO's approval. */
  status?: QuestStatus;
}

/**
 * Seed a new company: the wiki (BRIEF / OKRS / BACKLOG) on the chair bot, and
 * ONE quest with its roadmap as work items (docs/company-quests.md §7). Shared by
 * the create route and the `company.create` tool.
 */
export async function seedCompany(
  store: Store,
  input: {
    userId: string;
    workspaceId: string;
    workspaceName: string;
    mission: string;
    chairBotId: string;
    dna?: CompanyDNA;
    quest?: SeedQuestInput;
  },
): Promise<void> {
  const { userId, workspaceId, workspaceName, mission, chairBotId, dna, quest } = input;
  const seededAt = new Date().toISOString();

  const writeWiki = async (fileName: string, content: string): Promise<void> => {
    const existing = (await store.listWorkspaceFiles(workspaceId)).find((file) => file.name === fileName);
    await store.upsertFile({
      id: existing?.id ?? randomUUID(),
      botId: existing?.botId ?? chairBotId,
      userId,
      workspaceId,
      name: fileName,
      content: content.slice(0, 20_000),
      createdAt: existing?.createdAt ?? seededAt,
      updatedAt: seededAt,
    });
  };
  const features = dna?.product.features ?? [];
  const gaps = dna?.product.gaps ?? [];
  const bullets = (items: string[], empty: string): string =>
    (items.length > 0 ? items : [empty]).map((item) => `- ${item}`).join("\n");

  await writeWiki(
    "BRIEF.md",
    `# ${workspaceName}\n\n${mission}\n\n` +
      (dna ? `Industry: ${dna.industry}\nStage: ${dna.stage}\nGoal: ${dna.goal}` : ""),
  );
  await writeWiki("OKRS.md", `# OKRs — ${workspaceName}\n\nGoal: ${dna?.goal ?? mission}`);
  await writeWiki(
    "BACKLOG.md",
    `# Backlog — ${workspaceName}\n\n## MVP\n${bullets(features, "Define the MVP")}\n\n` +
      `## Opportunities\n${bullets(gaps, "—")}`,
  );

  await seedQuest(store, { userId, workspaceId, dna, quest });
}

/** A default roadmap derived from the DNA when the direction didn't provide one. */
function roadmapFromDna(dna?: CompanyDNA): Array<{ phase: WorkPhase; title: string }> {
  const items: Array<{ phase: WorkPhase; title: string }> = [];
  for (const feature of (dna?.product.features ?? []).slice(0, 6)) items.push({ phase: "mvp", title: feature });
  for (const gap of (dna?.product.gaps ?? []).slice(0, 3)) items.push({ phase: "phase2", title: gap });
  if (items.length === 0) items.push({ phase: "mvp", title: "Define the MVP" });
  return items;
}

/** The department a direction's work belongs to. */
function departmentFor(directionId?: string): Department {
  if (directionId === "dir_growth") return "marketing";
  if (directionId === "dir_scale") return "success";
  return "product";
}

/**
 * Create the company's first (active) quest plus its roadmap work items
 * (docs/company-quests.md §7). Replaces the old feature-per-task seed dump.
 */
export async function seedQuest(
  store: Store,
  input: { userId: string; workspaceId: string; dna?: CompanyDNA; quest?: SeedQuestInput },
): Promise<Quest> {
  const { userId, workspaceId, dna, quest: requested } = input;
  const now = new Date().toISOString();
  const questId = randomUUID();
  const department = departmentFor(requested?.directionId);
  const roadmap = requested?.roadmap?.length ? requested.roadmap : roadmapFromDna(dna);
  const workItemIds: string[] = [];
  for (const item of roadmap.slice(0, 12)) {
    const title = (item.title ?? "").trim().slice(0, 200);
    if (!title) continue;
    const id = randomUUID();
    await store.createWorkItem({
      id,
      workspaceId,
      title,
      phase: item.phase,
      status: "todo",
      department,
      questId,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });
    workItemIds.push(id);
  }

  const quest: Quest = {
    id: questId,
    workspaceId,
    directionId: requested?.directionId,
    title: (requested?.title ?? dna?.goal ?? "First mission").trim().slice(0, 120) || "First mission",
    objective:
      (requested?.objective ?? dna?.goal ?? dna?.summary ?? "Get the company started").trim().slice(0, 500) ||
      "Get the company started",
    acceptance: (requested?.acceptance ?? []).slice(0, 8),
    status: requested?.status ?? "active",
    stage: requested?.stage ?? dna?.stage ?? "idea",
    ownerRoleId: "exec.ceo",
    trust: requested?.trust ?? "manual",
    workItemIds,
    createdAt: now,
    updatedAt: now,
  };
  await store.createQuest(quest);

  if (quest.status === "active") {
    const workspace = await store.getWorkspace(workspaceId);
    if (workspace) {
      workspace.activeQuestId = questId;
      await store.updateWorkspace(workspace);
    }
  }
  return quest;
}

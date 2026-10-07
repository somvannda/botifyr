import { randomUUID } from "node:crypto";
import type { CompanyDNA, Department, WorkItem } from "@botifyr/shared";
import type { Store } from "./store/index.js";

/**
 * Seed a new company: the wiki (BRIEF / OKRS / BACKLOG) on the chair bot, and a
 * first set of work items on the board. Shared by the create route and the
 * `company.create` tool (docs/company-workspace.md §7, §9).
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
  },
): Promise<void> {
  const { userId, workspaceId, workspaceName, mission, chairBotId, dna } = input;
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

  const seedItems: Array<{ title: string; phase: WorkItem["phase"]; department: Department }> = [];
  for (const feature of features.slice(0, 8)) {
    seedItems.push({ title: feature, phase: "mvp", department: "product" });
  }
  for (const gap of gaps.slice(0, 5)) {
    seedItems.push({ title: gap, phase: "phase2", department: "product" });
  }
  seedItems.push({ title: "Build the marketing website", phase: "mvp", department: "engineering" });
  if (features.length === 0 && gaps.length === 0) {
    seedItems.unshift({ title: "Define the MVP", phase: "mvp", department: "product" });
  }
  for (const seedItem of seedItems) {
    await store.createWorkItem({
      id: randomUUID(),
      workspaceId,
      title: seedItem.title.slice(0, 200),
      phase: seedItem.phase,
      status: "todo",
      department: seedItem.department,
      createdBy: userId,
      createdAt: seededAt,
      updatedAt: seededAt,
    });
  }
}

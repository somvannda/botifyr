// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { BotifyrClient } from "@botifyr/client";
import type { Quest, WorkItem, WorkspaceWithRoles } from "@botifyr/shared";
import { CompanyWorkspace } from "./CompanyWorkspace";

/**
 * DOM tests for the Startup Workspace (docs/product-plan.md §4–5): the founder
 * home renders from client data, and company creation is an inline one-input
 * flow rather than a modal.
 */

function fakeClient(overrides: Record<string, unknown> = {}): BotifyrClient {
  const base = {
    listWorkItems: vi.fn().mockResolvedValue([]),
    listWorkspaceNeeds: vi.fn().mockResolvedValue([]),
    getWorkspaceBudget: vi
      .fn()
      .mockResolvedValue({ workspaceId: "ws1", limitTokens: 0, usedTokens: 0, updatedAt: "" }),
    listCapabilityGrants: vi.fn().mockResolvedValue([]),
    listCompanyReports: vi.fn().mockResolvedValue([]),
    listQuests: vi.fn().mockResolvedValue([]),
    listWorkspaceFiles: vi.fn().mockResolvedValue([]),
    listProposals: vi.fn().mockResolvedValue([]),
    getWorkspace: vi.fn().mockResolvedValue(null),
  };
  return { ...base, ...overrides } as unknown as BotifyrClient;
}

const company = {
  id: "ws1",
  ownerId: "u1",
  name: "Chmaba",
  source: { kind: "idea", value: "cloud pos" },
  mission: "Cloud POS for Cambodia",
  status: "active",
  autonomy: "supervised",
  avatarEmoji: "🏢",
  ceoBotId: "bot1",
  createdAt: "",
  updatedAt: "",
  roles: [
    {
      workspaceId: "ws1",
      botId: "bot1",
      title: "CEO",
      department: "exec",
      isChair: true,
      hiredAt: "",
    },
  ],
} as WorkspaceWithRoles;

const quest = {
  id: "q1",
  workspaceId: "ws1",
  title: "Ship the MVP",
  objective: "Define the first release",
  acceptance: [],
  status: "active",
  stage: "mvp",
  trust: "supervised",
  workItemIds: [],
  createdAt: "",
  updatedAt: "",
} as Quest;

const work = {
  id: "w1",
  workspaceId: "ws1",
  title: "Research the market",
  detail: "Understand competitors and target customers.",
  phase: "mvp",
  status: "todo",
  department: "product",
  questId: "q1",
  createdAt: "",
  updatedAt: "",
} as WorkItem;

describe("CompanyWorkspace (DOM)", () => {
  afterEach(cleanup);

  it("shows the one-input onboarding when there is no company", () => {
    render(
      <CompanyWorkspace
        client={fakeClient()}
        companies={[]}
        bots={[]}
        onOpenOffice={() => {}}
        onCreated={() => {}}
      />,
    );
    expect(screen.getByText(/what do you want to build/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /create my virtual company/i })).toBeTruthy();
    // No pop-up modal — the flow is inline.
    expect(document.querySelector(".apps-overlay")).toBeNull();
  });

  it("shows the founder home — mission, priorities and their tag", async () => {
    const client = fakeClient({
      listQuests: vi.fn().mockResolvedValue([quest]),
      listWorkItems: vi.fn().mockResolvedValue([work]),
    });
    render(
      <CompanyWorkspace
        client={client}
        companies={[company]}
        bots={[{ id: "bot1", name: "Maya" } as never]}
        onOpenOffice={() => {}}
        onCreated={() => {}}
      />,
    );
    // The mission title appears both in the "First milestone" stat and the mission card.
    expect((await screen.findAllByText("Ship the MVP")).length).toBeGreaterThan(0);
    expect(screen.getByText("Research the market")).toBeTruthy();
    expect(screen.getByText("AI can execute")).toBeTruthy();
    // The founder-home sections the guidance calls for.
    expect(screen.getByText(/today.s priorities/i)).toBeTruthy();
    expect(screen.getByText(/since you were last here/i)).toBeTruthy();
    expect(screen.getByText(/what would you like to do\?/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /tell the ai ceo what to do/i })).toBeTruthy();
  });

  it("shows the three autonomy levels, defaulting an un-activated company to Assisted", () => {
    const manual = { ...company, autonomy: "manual" } as WorkspaceWithRoles;
    render(
      <CompanyWorkspace
        client={fakeClient()}
        companies={[manual]}
        bots={[]}
        onOpenOffice={() => {}}
        onCreated={() => {}}
      />,
    );
    const select = screen.getByLabelText(/autonomy level/i) as HTMLSelectElement;
    expect(select.value).toBe("manual");
    expect(screen.getByRole("option", { name: /delegated/i })).toBeTruthy();
    expect(screen.getByRole("option", { name: /autonomous/i })).toBeTruthy();
  });

  it("rewrites the idea with AI before planning", async () => {
    const brief =
      "Build Chmaba, a cloud POS for Cambodian SMEs, targeting cafés and retail; launch an MVP in 90 days.";
    const client = fakeClient({
      rewriteCompanyBrief: vi.fn().mockResolvedValue({ brief }),
    });
    render(
      <CompanyWorkspace
        client={client}
        companies={[]}
        bots={[]}
        onOpenOffice={() => {}}
        onCreated={() => {}}
      />,
    );
    const box = screen.getByPlaceholderText(/build a cloud pos/i) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "cloud pos for cambodia" } });
    fireEvent.click(screen.getByRole("button", { name: /refine with ai/i }));
    await waitFor(() => expect(box.value).toBe(brief));
    expect(screen.getByText(/brief rewritten/i)).toBeTruthy();
    expect(client.rewriteCompanyBrief).toHaveBeenCalledTimes(1);
  });
});

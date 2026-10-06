import type { ToolDefinition } from "@botifyr/agent-core";
import { connectionToken } from "./connections-tools.js";
import type { Store } from "./store/index.js";

/** Agent tools that use a connected GitHub account (personal access token). */
async function gh(
  token: string,
  url: string,
  init?: { method?: string; body?: string },
): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "botifyr",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    body: init?.body,
  });
  const text = await response.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep raw */
  }
  return { ok: response.ok, status: response.status, data };
}

export function createGithubTools(store: Store, vaultKey: Buffer, userId: string): ToolDefinition[] {
  return [
    {
      name: "github.list_repos",
      description: "List the user's most recently updated GitHub repositories.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const token = await connectionToken(store, vaultKey, userId, "github");
        if (!token) return { ok: false, output: "GitHub isn't connected. Connect it in the Marketplace." };
        const result = await gh(token, "https://api.github.com/user/repos?per_page=10&sort=updated");
        if (!result.ok)
          return {
            ok: false,
            output: `GitHub error ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`,
          };
        const repos = (
          result.data as Array<{ full_name: string; description?: string; private: boolean }>
        ).map((repo) => `- ${repo.full_name}${repo.private ? " (private)" : ""}: ${repo.description ?? ""}`);
        return { ok: true, output: repos.length ? repos.join("\n") : "No repositories." };
      },
    },
    {
      name: "github.list_issues",
      description: "List open GitHub issues for a repository (owner/name).",
      parameters: {
        type: "object",
        properties: { repo: { type: "string", description: "owner/name" } },
        required: ["repo"],
      },
      run: async (args) => {
        const token = await connectionToken(store, vaultKey, userId, "github");
        if (!token) return { ok: false, output: "GitHub isn't connected. Connect it in the Marketplace." };
        const repo = String(args.repo ?? "");
        const result = await gh(token, `https://api.github.com/repos/${repo}/issues?state=open&per_page=10`);
        if (!result.ok)
          return {
            ok: false,
            output: `GitHub error ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`,
          };
        const issues = (result.data as Array<{ number: number; title: string }>).map(
          (issue) => `- #${issue.number} ${issue.title}`,
        );
        return { ok: true, output: issues.length ? issues.join("\n") : "No open issues." };
      },
    },
    {
      name: "github.create_issue",
      description: "Create a new GitHub issue in a repository (owner/name).",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/name" },
          title: { type: "string" },
          body: { type: "string" },
        },
        required: ["repo", "title"],
      },
      requiresApproval: true,
      run: async (args) => {
        const token = await connectionToken(store, vaultKey, userId, "github");
        if (!token) return { ok: false, output: "GitHub isn't connected. Connect it in the Marketplace." };
        const result = await gh(token, `https://api.github.com/repos/${String(args.repo ?? "")}/issues`, {
          method: "POST",
          body: JSON.stringify({ title: String(args.title ?? ""), body: String(args.body ?? "") }),
        });
        if (!result.ok)
          return {
            ok: false,
            output: `GitHub error ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`,
          };
        const link = (result.data as { html_url?: string }).html_url ?? "created";
        return { ok: true, output: `Issue created: ${link}` };
      },
    },
    {
      name: "github.comment",
      description: "Comment on a GitHub issue or pull request.",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/name" },
          number: { type: "number", description: "Issue or PR number" },
          body: { type: "string" },
        },
        required: ["repo", "number", "body"],
      },
      requiresApproval: true,
      run: async (args) => {
        const token = await connectionToken(store, vaultKey, userId, "github");
        if (!token) return { ok: false, output: "GitHub isn't connected. Connect it in the Marketplace." };
        const result = await gh(
          token,
          `https://api.github.com/repos/${String(args.repo ?? "")}/issues/${Number(args.number ?? 0)}/comments`,
          { method: "POST", body: JSON.stringify({ body: String(args.body ?? "") }) },
        );
        if (!result.ok)
          return {
            ok: false,
            output: `GitHub error ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`,
          };
        const link = (result.data as { html_url?: string }).html_url ?? "posted";
        return { ok: true, output: `Comment posted: ${link}` };
      },
    },
    {
      name: "github.list_prs",
      description: "List open pull requests for a repository (owner/name).",
      parameters: {
        type: "object",
        properties: { repo: { type: "string", description: "owner/name" } },
        required: ["repo"],
      },
      run: async (args) => {
        const token = await connectionToken(store, vaultKey, userId, "github");
        if (!token) return { ok: false, output: "GitHub isn't connected. Connect it in the Marketplace." };
        const repo = String(args.repo ?? "");
        const result = await gh(token, `https://api.github.com/repos/${repo}/pulls?state=open&per_page=10`);
        if (!result.ok)
          return {
            ok: false,
            output: `GitHub error ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`,
          };
        const prs = (result.data as Array<{ number: number; title: string; head?: { ref?: string } }>).map(
          (pr) => `- #${pr.number} ${pr.title} (${pr.head?.ref ?? "?"})`,
        );
        return { ok: true, output: prs.length ? prs.join("\n") : "No open pull requests." };
      },
    },
    {
      name: "github.create_pr",
      description: "Open a pull request from a head branch into a base branch (owner/name).",
      parameters: {
        type: "object",
        properties: {
          repo: { type: "string", description: "owner/name" },
          title: { type: "string" },
          head: { type: "string", description: "source branch" },
          base: { type: "string", description: "target branch (e.g. main)" },
          body: { type: "string" },
        },
        required: ["repo", "title", "head", "base"],
      },
      requiresApproval: true,
      run: async (args) => {
        const token = await connectionToken(store, vaultKey, userId, "github");
        if (!token) return { ok: false, output: "GitHub isn't connected. Connect it in the Marketplace." };
        const result = await gh(token, `https://api.github.com/repos/${String(args.repo ?? "")}/pulls`, {
          method: "POST",
          body: JSON.stringify({
            title: String(args.title ?? ""),
            head: String(args.head ?? ""),
            base: String(args.base ?? ""),
            body: String(args.body ?? ""),
          }),
        });
        if (!result.ok)
          return {
            ok: false,
            output: `GitHub error ${result.status}: ${JSON.stringify(result.data).slice(0, 300)}`,
          };
        const link = (result.data as { html_url?: string }).html_url ?? "created";
        return { ok: true, output: `Pull request opened: ${link}` };
      },
    },
  ];
}

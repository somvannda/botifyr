import type { ToolDefinition } from "@botifyr/agent-core";
import { connectionToken } from "./connections-tools.js";
import type { Store } from "./store/index.js";

/** Agent tools that use a connected GitHub account (personal access token). */
async function gh(token: string, url: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "user-agent": "botifyr",
    },
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
  ];
}

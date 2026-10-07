import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { ToolDefinition } from "@botifyr/agent-core";
import type { CodeRepo } from "@botifyr/shared";

/**
 * Read-only code tools for the engineering team (docs/codebase-access.md, Phase 1).
 * Every path is jailed inside the connected repo; output is bounded so a large
 * repo can't blow up the model context. No writes, no network.
 */
const execFileAsync = promisify(execFile);

const IGNORED = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".turbo",
  "target",
  ".cache",
]);
const MAX_READ = 200_000;
const MAX_HITS = 200;
const MAX_TREE = 400;
const MAX_DEPTH = 8;

/** Relative path with forward slashes, so output is OS-independent. */
function relPosix(root: string, full: string): string {
  return path.relative(root, full).split(path.sep).join("/");
}

/**
 * Map a checkout path inside the cloud to a Docker mount spec usable by a
 * sibling sandbox container (docker-outside-of-docker needs host paths, not
 * container paths). Returns null when the checkout isn't sandbox-reachable.
 */
export function sandboxMount(
  containerPath: string,
): { volume: string; workdir: string; writable: boolean } | null {
  const reposDir = process.env.BOTIFYR_REPOS_DIR ?? "/repos";
  const managedDir = process.env.BOTIFYR_MANAGED_DIR ?? "/managed";
  if (containerPath === reposDir || containerPath.startsWith(reposDir + "/")) {
    const host = process.env.BOTIFYR_REPOS_HOST;
    if (!host) return null;
    return { volume: `${host}:${containerPath}:ro`, workdir: containerPath, writable: false };
  }
  if (containerPath === managedDir || containerPath.startsWith(managedDir + "/")) {
    const sub = containerPath === managedDir ? "" : containerPath.slice(managedDir.length + 1);
    return { volume: "botifyr-managed:/mnt", workdir: sub ? `/mnt/${sub}` : "/mnt", writable: true };
  }
  return null;
}

/** True when the checkout is a managed clone (writable, safe to commit into). */
function isManaged(containerPath: string): boolean {
  const managedDir = process.env.BOTIFYR_MANAGED_DIR ?? "/managed";
  return containerPath === managedDir || containerPath.startsWith(managedDir + path.sep);
}

/** Parse owner/repo/host from a git clone URL. */
export function parseRepo(url: string): { host: string; owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname
      .replace(/^\/+/, "")
      .replace(/\.git$/, "")
      .split("/");
    if (parts.length < 2) return null;
    return { host: parsed.hostname, owner: parts[0] as string, repo: parts[1] as string };
  } catch {
    return null;
  }
}

/** Resolve `relative` inside `root`, refusing anything that escapes it. */
function jail(root: string, relative: string): string {
  const base = path.resolve(root);
  const resolved = path.resolve(base, relative || ".");
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error("path escapes the repository");
  }
  return resolved;
}

export interface CodeToolIo {
  /** Writable directory where proposed changes are staged (Phase 2). */
  workDir?: string;
  /** Workspace id, so staged changes are scoped per company. */
  workspaceId?: string;
  /** Persist a wiki file on the workspace (e.g. CODEBASE.md). */
  saveWikiFile?: (name: string, content: string) => Promise<void>;
  /** Resolve a vault secret to a plaintext token (never logged or returned). */
  getToken?: (secretName: string) => Promise<string | null>;
}

export function createCodeTools(repos: CodeRepo[], io: CodeToolIo = {}): ToolDefinition[] {
  const choose = (name: unknown): CodeRepo | null => {
    if (repos.length === 0) return null;
    const requested = String(name ?? "")
      .trim()
      .toLowerCase();
    if (requested) return repos.find((repo) => repo.name.toLowerCase() === requested) ?? null;
    return repos.length === 1 ? (repos[0] as CodeRepo) : null;
  };
  const repoProp = { type: "string", description: "Repository name (when more than one is connected)." };
  const pathProp = { type: "string", description: "Path relative to the repository root." };
  const noRepo = (repo: CodeRepo | null) => {
    if (repo) return null;
    return repos.length === 0
      ? "No repository is connected to this company."
      : `Which repo? ${repos.map((entry) => entry.name).join(", ")}.`;
  };

  return [
    {
      name: "code.tree",
      description: "List the repository file tree (bounded). Narrow it with a subpath.",
      parameters: {
        type: "object",
        properties: { path: pathProp, repo: repoProp },
      },
      run: async (args) => {
        const repo = choose(args.repo);
        const missing = noRepo(repo);
        if (missing || !repo) return { ok: false, output: missing ?? "No repository." };
        let root: string;
        try {
          root = jail(repo.path, String(args.path ?? ""));
        } catch {
          return { ok: false, output: "That path is outside the repository." };
        }
        if (!existsSync(root)) return { ok: false, output: `Not found: ${args.path ?? "/"}` };
        const out: string[] = [];
        const walk = async (dir: string, depth: number, prefix: string): Promise<void> => {
          if (out.length >= MAX_TREE || depth > MAX_DEPTH) return;
          const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
          for (const entry of entries) {
            if (out.length >= MAX_TREE) break;
            if (IGNORED.has(entry.name)) continue;
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            out.push(entry.isDirectory() ? `${rel}/` : rel);
            if (entry.isDirectory()) await walk(path.join(dir, entry.name), depth + 1, rel);
          }
        };
        await walk(root, 0, "");
        return { ok: true, output: out.join("\n").slice(0, 20_000) || "(empty)" };
      },
    },
    {
      name: "code.search",
      description: "Search the repository for text (regex or literal). Returns file:line hits.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, path: pathProp, repo: repoProp },
        required: ["query"],
      },
      run: async (args) => {
        const repo = choose(args.repo);
        const missing = noRepo(repo);
        if (missing || !repo) return { ok: false, output: missing ?? "No repository." };
        const query = String(args.query ?? "").trim();
        if (!query) return { ok: false, output: "A query is required." };
        let pattern: RegExp;
        try {
          pattern = new RegExp(query, "i");
        } catch {
          pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        }
        let root: string;
        try {
          root = jail(repo.path, String(args.path ?? ""));
        } catch {
          return { ok: false, output: "That path is outside the repository." };
        }
        const hits: string[] = [];
        const walk = async (dir: string, depth: number): Promise<void> => {
          if (hits.length >= MAX_HITS || depth > MAX_DEPTH) return;
          const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
          for (const entry of entries) {
            if (hits.length >= MAX_HITS) break;
            if (IGNORED.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await walk(full, depth + 1);
              continue;
            }
            const info = await stat(full).catch(() => null);
            if (!info || info.size > MAX_READ) continue;
            const text = await readFile(full, "utf8").catch(() => null);
            if (text === null) continue;
            const lines = text.split("\n");
            for (let index = 0; index < lines.length && hits.length < MAX_HITS; index += 1) {
              if (pattern.test(lines[index] as string)) {
                hits.push(
                  `${relPosix(repo.path, full)}:${index + 1}: ${(lines[index] as string).trim().slice(0, 200)}`,
                );
              }
            }
          }
        };
        await walk(root, 0);
        return { ok: true, output: hits.length ? hits.join("\n").slice(0, 20_000) : "No matches." };
      },
    },
    {
      name: "code.read",
      description: "Read a file from the repository (optionally a line range).",
      parameters: {
        type: "object",
        properties: {
          path: pathProp,
          start: { type: "number", description: "First line (1-based)." },
          lines: { type: "number", description: "How many lines (max 400)." },
          repo: repoProp,
        },
        required: ["path"],
      },
      run: async (args) => {
        const repo = choose(args.repo);
        const missing = noRepo(repo);
        if (missing || !repo) return { ok: false, output: missing ?? "No repository." };
        let full: string;
        try {
          full = jail(repo.path, String(args.path ?? ""));
        } catch {
          return { ok: false, output: "That path is outside the repository." };
        }
        const text = await readFile(full, "utf8").catch(() => null);
        if (text === null) return { ok: false, output: `Couldn't read ${args.path}.` };
        const start = Math.max(1, Math.floor(Number(args.start) || 1));
        const count = Math.min(400, Math.max(1, Math.floor(Number(args.lines) || 200)));
        const slice = text.split("\n").slice(start - 1, start - 1 + count).join("\n");
        return { ok: true, output: slice.slice(0, MAX_READ) };
      },
    },
    {
      name: "code.git_log",
      description: "Show recent git commits (read-only history).",
      parameters: { type: "object", properties: { repo: repoProp } },
      run: async (args) => {
        const repo = choose(args.repo);
        const missing = noRepo(repo);
        if (missing || !repo) return { ok: false, output: missing ?? "No repository." };
        if (!existsSync(path.join(repo.path, ".git"))) {
          return { ok: false, output: "That repository has no .git history." };
        }
        try {
          const { stdout } = await execFileAsync("git", ["-C", repo.path, "log", "--oneline", "-20"], {
            timeout: 10_000,
            maxBuffer: 1_000_000,
          });
          return { ok: true, output: stdout.slice(0, 20_000) || "(no commits)" };
        } catch {
          return { ok: false, output: "git history is unavailable." };
        }
      },
    },
    {
      name: "code.apply",
      description:
        "Propose a code change: write a file's new contents into the company's writable work area for the CEO to review. Needs approval.",
      parameters: {
        type: "object",
        properties: {
          path: pathProp,
          content: { type: "string", description: "The full new contents of the file." },
          repo: repoProp,
        },
        required: ["path", "content"],
      },
      requiresApproval: true,
      run: async (args) => {
        const repo = choose(args.repo);
        const missing = noRepo(repo);
        if (missing || !repo) return { ok: false, output: missing ?? "No repository." };
        if (!io.workDir) return { ok: false, output: "No writable work area is configured." };
        const base = path.resolve(io.workDir, io.workspaceId ?? "_", repo.name);
        const full = path.resolve(base, String(args.path ?? ""));
        if (full !== base && !full.startsWith(base + path.sep)) {
          return { ok: false, output: "That path is outside the work area." };
        }
        await mkdir(path.dirname(full), { recursive: true });
        await writeFile(full, String(args.content ?? ""));
        return { ok: true, output: `Proposed change staged at ${full}. The CEO can review it.` };
      },
    },
    {
      name: "code.map",
      description:
        "Summarise the connected repository (structure + file types) and save it as CODEBASE.md in the company wiki.",
      parameters: { type: "object", properties: { repo: repoProp } },
      run: async (args) => {
        const repo = choose(args.repo);
        const missing = noRepo(repo);
        if (missing || !repo) return { ok: false, output: missing ?? "No repository." };
        const files: string[] = [];
        const walk = async (dir: string, depth: number, prefix: string): Promise<void> => {
          if (files.length >= MAX_TREE * 5 || depth > MAX_DEPTH) return;
          const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
          for (const entry of entries) {
            if (IGNORED.has(entry.name)) continue;
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            if (entry.isDirectory()) await walk(path.join(dir, entry.name), depth + 1, rel);
            else files.push(rel);
          }
        };
        await walk(repo.path, 0, "");
        const byExt = new Map<string, number>();
        for (const file of files) {
          const ext = path.extname(file) || "(none)";
          byExt.set(ext, (byExt.get(ext) ?? 0) + 1);
        }
        const top = [...new Set(files.map((file) => file.split("/")[0]))].sort();
        const content = [
          `# Codebase map — ${repo.name}`,
          "",
          `Path: \`${repo.path}\``,
          `Files scanned: ${files.length}`,
          "",
          "## Top level",
          ...top.slice(0, 50).map((entry) => `- ${entry}`),
          "",
          "## Files by extension",
          ...[...byExt.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([ext, count]) => `- \`${ext}\`: ${count}`),
        ]
          .join("\n")
          .slice(0, 20_000);
        if (io.saveWikiFile) await io.saveWikiFile("CODEBASE.md", content);
        return { ok: true, output: content };
      },
    },
    {
      name: "code.test",
      description:
        "Run the repository's tests in a throwaway sandbox (no network) and return the output. Needs approval.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Optional test command (default: the repo's test script)." },
          install: {
            type: "string",
            description: "Optional install command to run first (e.g. 'npm ci'); needs a managed clone.",
          },
          repo: repoProp,
        },
      },
      requiresApproval: true,
      run: async (args) => {
        const repo = choose(args.repo);
        const missing = noRepo(repo);
        if (missing || !repo) return { ok: false, output: missing ?? "No repository." };
        const mount = sandboxMount(repo.path);
        if (!mount) {
          return { ok: false, output: "This checkout isn't reachable by the sandbox (no host mapping)." };
        }
        const image = process.env.BOTIFYR_TEST_IMAGE ?? "node:22-bookworm-slim";
        const install = String(args.install ?? "").trim() || process.env.BOTIFYR_TEST_INSTALL || "";
        if (install) {
          if (!mount.writable) {
            return {
              ok: false,
              output: "Installing dependencies needs a writable checkout — clone the repo by URL.",
            };
          }
          try {
            await execFileAsync(
              "docker",
              ["run", "--rm", "-v", mount.volume, "-w", mount.workdir, image, "sh", "-lc", install],
              { timeout: 300_000, maxBuffer: 4_000_000 },
            );
          } catch (error) {
            const failure = error as { stdout?: string; stderr?: string; message?: string };
            const text =
              `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`.trim() ||
              failure.message ||
              "install failed";
            return { ok: false, output: `Install failed:\n${text}`.slice(0, 20_000) };
          }
        }
        const command =
          String(args.command ?? "").trim() ||
          process.env.BOTIFYR_TEST_COMMAND ||
          'if [ -f package.json ]; then npm test --silent --if-present; ' +
            'elif [ -f Makefile ]; then make test; ' +
            'else echo "No test runner detected."; fi';
        try {
          const { stdout, stderr } = await execFileAsync(
            "docker",
            [
              "run",
              "--rm",
              "--network",
              "none",
              "-v",
              mount.volume,
              "-w",
              mount.workdir,
              image,
              "sh",
              "-lc",
              command,
            ],
            { timeout: 180_000, maxBuffer: 2_000_000 },
          );
          return { ok: true, output: `$ ${command}\n${stdout}\n${stderr}`.slice(0, 20_000) };
        } catch (error) {
          const failure = error as { stdout?: string; stderr?: string; message?: string };
          const text = `${failure.stdout ?? ""}\n${failure.stderr ?? ""}`.trim() || failure.message || "test run failed";
          return { ok: false, output: text.slice(0, 20_000) };
        }
      },
    },
    {
      name: "code.commit",
      description:
        "Apply the staged changes to a managed checkout and commit them on a new branch for review. Needs approval.",
      parameters: {
        type: "object",
        properties: {
          message: { type: "string", description: "Commit message." },
          repo: repoProp,
        },
        required: ["message"],
      },
      requiresApproval: true,
      run: async (args) => {
        const repo = choose(args.repo);
        const missing = noRepo(repo);
        if (missing || !repo) return { ok: false, output: missing ?? "No repository." };
        if (!isManaged(repo.path)) {
          return {
            ok: false,
            output: "Only managed clones (cloned by URL) can be committed to — the local mount is read-only.",
          };
        }
        if (!io.workDir) return { ok: false, output: "No writable work area is configured." };
        const overlay = path.join(io.workDir, io.workspaceId ?? "_", repo.name);
        const root = path.resolve(repo.path);
        let applied = 0;
        const applyDir = async (dir: string, prefix: string): Promise<void> => {
          const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
          for (const entry of entries) {
            const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
            const target = path.resolve(root, rel);
            if (target !== root && !target.startsWith(root + path.sep)) continue;
            if (entry.isDirectory()) {
              await mkdir(target, { recursive: true });
              await applyDir(path.join(dir, entry.name), rel);
            } else {
              await mkdir(path.dirname(target), { recursive: true });
              await writeFile(target, await readFile(path.join(dir, entry.name)));
              applied += 1;
            }
          }
        };
        await applyDir(overlay, "");
        if (applied === 0) return { ok: false, output: "Nothing is staged to commit." };
        const branch = `botifyr/${Date.now().toString(36)}`;
        try {
          await execFileAsync("git", ["-C", repo.path, "checkout", "-b", branch], { timeout: 30_000 });
          await execFileAsync("git", ["-C", repo.path, "add", "-A"], { timeout: 30_000 });
          await execFileAsync(
            "git",
            [
              "-C",
              repo.path,
              "-c",
              "user.email=agents@botifyr.ai",
              "-c",
              "user.name=Botifyr",
              "commit",
              "-m",
              String(args.message ?? "").slice(0, 500),
            ],
            { timeout: 30_000 },
          );
          return {
            ok: true,
            output: `Committed ${applied} file(s) on branch ${branch}. Push + open a PR from the repo connection to share it.`,
          };
        } catch (error) {
          return { ok: false, output: String((error as Error).message).slice(0, 1000) };
        }
      },
    },
    {
      name: "code.pr",
      description:
        "Push the committed branch and open a pull request on the repository's host (GitHub). Needs approval.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Pull request title." },
          body: { type: "string", description: "Pull request description." },
          base: { type: "string", description: "Base branch (default: the repo's branch or main)." },
          repo: repoProp,
        },
        required: ["title"],
      },
      requiresApproval: true,
      run: async (args) => {
        const repo = choose(args.repo);
        const missing = noRepo(repo);
        if (missing || !repo) return { ok: false, output: missing ?? "No repository." };
        if (!isManaged(repo.path)) {
          return { ok: false, output: "Only a managed clone can be pushed — clone the repo by URL." };
        }
        if (!repo.url) return { ok: false, output: "This repo has no clone URL to push to." };
        const info = parseRepo(repo.url);
        if (!info) return { ok: false, output: "Couldn't parse the repository URL." };

        let token: string | null = process.env.BOTIFYR_GIT_TOKEN ?? null;
        if (repo.tokenSecret && io.getToken) {
          token = (await io.getToken(repo.tokenSecret).catch(() => null)) ?? token;
        }
        if (!token) {
          return { ok: false, output: "No push token — set a vault secret or BOTIFYR_GIT_TOKEN." };
        }

        const { stdout } = await execFileAsync(
          "git",
          ["-C", repo.path, "rev-parse", "--abbrev-ref", "HEAD"],
          { timeout: 30_000 },
        );
        const branch = stdout.trim();
        const base = String(args.base ?? "").trim() || repo.branch || "main";
        if (branch === base || branch === "main" || branch === "master" || branch === "HEAD") {
          return { ok: false, output: "Commit to a feature branch first (use code.commit)." };
        }

        const pushUrl = new URL(repo.url);
        pushUrl.username = "x-access-token";
        pushUrl.password = token;
        try {
          await execFileAsync(
            "git",
            ["-C", repo.path, "push", pushUrl.toString(), `${branch}:${branch}`],
            { timeout: 180_000, maxBuffer: 2_000_000 },
          );
        } catch (error) {
          const detail = String((error as Error).message).split(token).join("***").slice(0, 500);
          return { ok: false, output: `Push failed: ${detail}` };
        }

        if (info.host.endsWith("github.com")) {
          try {
            const response = await fetch(`https://api.github.com/repos/${info.owner}/${info.repo}/pulls`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "Content-Type": "application/json",
                "User-Agent": "botifyr",
              },
              body: JSON.stringify({
                title: String(args.title).slice(0, 200),
                head: branch,
                base,
                body: String(args.body ?? "").slice(0, 10_000),
              }),
            });
            const data = (await response.json()) as { html_url?: string; message?: string };
            if (!response.ok) {
              return { ok: false, output: `Pushed ${branch}, but the PR failed: ${data.message ?? response.status}` };
            }
            return { ok: true, output: `Pushed ${branch} and opened PR: ${data.html_url}` };
          } catch (error) {
            return {
              ok: false,
              output: `Pushed ${branch}, but the PR request errored: ${String((error as Error).message).slice(0, 300)}`,
            };
          }
        }
        if (info.host.includes("gitlab")) {
          try {
            const project = encodeURIComponent(`${info.owner}/${info.repo}`);
            const response = await fetch(
              `https://${info.host}/api/v4/projects/${project}/merge_requests`,
              {
                method: "POST",
                headers: { "PRIVATE-TOKEN": token, "Content-Type": "application/json" },
                body: JSON.stringify({
                  source_branch: branch,
                  target_branch: base,
                  title: String(args.title).slice(0, 200),
                  description: String(args.body ?? "").slice(0, 10_000),
                }),
              },
            );
            const data = (await response.json()) as { web_url?: string; error?: string };
            if (!response.ok) {
              return {
                ok: false,
                output: `Pushed ${branch}, but the MR failed: ${data.error ?? response.status}`,
              };
            }
            return { ok: true, output: `Pushed ${branch} and opened MR: ${data.web_url}` };
          } catch (error) {
            return {
              ok: false,
              output: `Pushed ${branch}, but the MR request errored: ${String((error as Error).message).slice(0, 300)}`,
            };
          }
        }
        return {
          ok: true,
          output: `Pushed ${branch}. Open a pull request on ${info.host} (${info.owner}/${info.repo}).`,
        };
      },
    },
  ];
}

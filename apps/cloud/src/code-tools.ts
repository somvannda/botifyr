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
  /** Persist a wiki file on the workspace (e.g. CODEBASE.md). */
  saveWikiFile?: (name: string, content: string) => Promise<void>;
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
        const base = path.resolve(io.workDir, repo.name);
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
  ];
}

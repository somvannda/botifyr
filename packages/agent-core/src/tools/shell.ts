import type { ToolDefinition, ToolResult } from "../types.js";

/**
 * Code/shell backend: run commands and read/write files inside the isolated
 * sandbox. `shell.exec` is approval-gated (it runs arbitrary code); file
 * operations are not, and all paths stay inside the sandbox workspace.
 */
export interface ShellBackend {
  exec(command: string): Promise<ToolResult>;
  readFile(path: string): Promise<ToolResult>;
  writeFile(path: string, content: string): Promise<ToolResult>;
  listFiles(path: string): Promise<ToolResult>;
  close(): Promise<void>;
}

export interface ShellTools {
  tools: ToolDefinition[];
  close(): Promise<void>;
}

export function createShellTools(backend: ShellBackend): ShellTools {
  const exec: ToolDefinition = {
    name: "shell.exec",
    description:
      "Run a shell command inside the isolated code sandbox and return its output. Use it for scripts, data processing, and CLI tools.",
    parameters: {
      type: "object",
      properties: { command: { type: "string", description: "Shell command to run." } },
      required: ["command"],
    },
    requiresApproval: true,
    run: (args): Promise<ToolResult> => backend.exec(String(args.command)),
  };

  const read: ToolDefinition = {
    name: "file.read",
    description: "Read a text file from the sandbox workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Path relative to the workspace." } },
      required: ["path"],
    },
    run: (args): Promise<ToolResult> => backend.readFile(String(args.path)),
  };

  const write: ToolDefinition = {
    name: "file.write",
    description:
      "Write a text file into the sandbox workspace (folders created as needed). Temporary per run — to keep something for the team, use library.write instead.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace." },
        content: { type: "string", description: "File content." },
      },
      required: ["path", "content"],
    },
    run: (args): Promise<ToolResult> => backend.writeFile(String(args.path), String(args.content ?? "")),
  };

  const list: ToolDefinition = {
    name: "file.list",
    description: "List files and folders in the sandbox workspace.",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Directory relative to the workspace." } },
    },
    run: (args): Promise<ToolResult> => backend.listFiles(args.path ? String(args.path) : "."),
  };

  return {
    tools: [exec, read, write, list],
    close: () => backend.close(),
  };
}

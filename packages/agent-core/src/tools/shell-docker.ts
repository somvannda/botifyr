import type { ToolResult } from "../types.js";
import type { ShellBackend } from "./shell.js";
import { createContainerHandle } from "../sandbox/docker.js";

/**
 * Container-isolated code/shell backend. One throwaway container per task with
 * its own /workspace, run as a non-root user.
 */

export interface DockerShellOptions {
  image?: string;
  containerPort?: number;
  volumes?: string[];
  startupTimeoutMs?: number;
}

interface SandboxResponse {
  ok: boolean;
  output: string;
}

export function createDockerShellBackend(options: DockerShellOptions = {}): ShellBackend {
  const handle = createContainerHandle({
    image: options.image ?? process.env.BOTIFYR_CODE_IMAGE ?? "botifyr/code-sandbox:1",
    containerPort: options.containerPort ?? 8792,
    namePrefix: "botifyr-code",
    volumes: options.volumes,
    startupTimeoutMs: options.startupTimeoutMs ?? 60_000,
  });

  async function action(actionName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const base = await handle.ensureStarted();
    const response = await fetch(`${base}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: actionName, args }),
    });
    if (!response.ok) {
      throw new Error(`code action "${actionName}" failed (${response.status})`);
    }
    const json = (await response.json()) as SandboxResponse;
    return { ok: json.ok, output: json.output };
  }

  return {
    exec: (command: string) => action("exec", { command }),
    readFile: (path: string) => action("read", { path }),
    writeFile: (path: string, content: string) => action("write", { path, content }),
    listFiles: (path: string) => action("list", { path }),
    close: () => handle.close(),
  };
}

import type { ToolResult } from "../types.js";
import type { ComputerBackend } from "./computer.js";
import { createContainerHandle } from "../sandbox/docker.js";

/**
 * Container-isolated desktop computer-use backend. One throwaway container per
 * task runs a virtual X desktop; the agent controls it over HTTP and can watch
 * the live framebuffer stream.
 */

export interface DockerComputerOptions {
  image?: string;
  containerPort?: number;
  startupTimeoutMs?: number;
}

interface SandboxResponse {
  ok: boolean;
  output: string;
  screenshot?: string; // base64 PNG
}

export function createDockerComputerBackend(options: DockerComputerOptions = {}): ComputerBackend {
  const handle = createContainerHandle({
    image: options.image ?? process.env.BOTIFYR_DESKTOP_IMAGE ?? "botifyr/desktop-sandbox:1",
    containerPort: options.containerPort ?? 8790,
    namePrefix: "botifyr-desk",
    startupTimeoutMs: options.startupTimeoutMs ?? 120_000,
  });

  async function action(actionName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const base = await handle.ensureStarted();
    const response = await fetch(`${base}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: actionName, args }),
    });
    if (!response.ok) {
      throw new Error(`computer action "${actionName}" failed (${response.status})`);
    }
    const json = (await response.json()) as SandboxResponse;
    return {
      ok: json.ok,
      output: json.output,
      screenshot: json.screenshot ? Buffer.from(json.screenshot, "base64") : undefined,
    };
  }

  return {
    screenshot: () => action("screenshot", {}),
    move: (x, y) => action("move", { x, y }),
    click: (x, y, button = 1) => action("click", { x, y, button }),
    type: (text) => action("type", { text }),
    key: (key) => action("key", { key }),
    scroll: (amount) => action("scroll", { amount }),
    record: (start: boolean) => action(start ? "record_start" : "record_stop", {}),
    streamUrl: async () => {
      try {
        return await handle.ensureStarted();
      } catch {
        return null;
      }
    },
    close: () => handle.close(),
  };
}

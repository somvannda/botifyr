import type { ToolResult } from "../types.js";
import type { BrowserBackend } from "./browser.js";
import { createContainerHandle } from "../sandbox/docker.js";

/**
 * Container-isolated browser backend.
 *
 * One throwaway container per task runs the browser sandbox service; the agent
 * talks to it over HTTP. Nothing the agent does touches the cloud process.
 */

export interface DockerBrowserOptions {
  image?: string;
  containerPort?: number;
  startupTimeoutMs?: number;
}

interface SandboxResponse {
  ok: boolean;
  output: string;
  screenshot?: string; // base64 PNG
}

export function createDockerBrowserBackend(options: DockerBrowserOptions = {}): BrowserBackend {
  const handle = createContainerHandle({
    image: options.image ?? process.env.BOTIFYR_SANDBOX_IMAGE ?? "botifyr/browser-sandbox:1.63.0",
    containerPort: options.containerPort ?? 8788,
    namePrefix: "botifyr-sbx",
    startupTimeoutMs: options.startupTimeoutMs,
  });

  async function action(actionName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const base = await handle.ensureStarted();
    const response = await fetch(`${base}/action`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: actionName, args }),
    });
    if (!response.ok) {
      throw new Error(`sandbox action "${actionName}" failed (${response.status})`);
    }
    const json = (await response.json()) as SandboxResponse;
    return {
      ok: json.ok,
      output: json.output,
      screenshot: json.screenshot ? Buffer.from(json.screenshot, "base64") : undefined,
    };
  }

  return {
    goto: (url: string) => action("goto", { url }),
    extract: (selector: string) => action("extract", { selector }),
    type: (selector: string, text: string) => action("type", { selector, text }),
    click: (selector: string) => action("click", { selector }),
    screenshot: () => action("screenshot", {}),
    close: () => handle.close(),
  };
}

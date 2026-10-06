import type { ToolDefinition, ToolResult } from "../types.js";

/**
 * A browser execution backend. Tools never touch Playwright directly — they
 * call a backend. That is what lets the exact same agent loop run against an
 * in-process browser (development) or a container-isolated browser (sandbox),
 * without changing a line of the loop or the model.
 */
export interface BrowserBackend {
  goto(url: string): Promise<ToolResult>;
  extract(selector: string): Promise<ToolResult>;
  type(selector: string, text: string): Promise<ToolResult>;
  click(selector: string): Promise<ToolResult>;
  screenshot(): Promise<ToolResult>;
  close(): Promise<void>;
}

export interface BrowserTools {
  tools: ToolDefinition[];
  close(): Promise<void>;
}

/** Wrap a backend as the tool set the agent loop understands. */
export function createBrowserTools(backend: BrowserBackend): BrowserTools {
  const goto: ToolDefinition = {
    name: "browser.goto",
    description: "Navigate the browser to a URL and wait for the page to load.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Absolute URL to open." } },
      required: ["url"],
    },
    run: (args): Promise<ToolResult> => backend.goto(String(args.url)),
  };

  const extract: ToolDefinition = {
    name: "browser.extract",
    description: "Read the visible text of the first element matching a CSS selector.",
    parameters: {
      type: "object",
      properties: { selector: { type: "string", description: "CSS selector." } },
      required: ["selector"],
    },
    run: (args): Promise<ToolResult> => backend.extract(String(args.selector)),
  };

  const type: ToolDefinition = {
    name: "browser.type",
    description: "Type text into an input or textarea identified by a CSS selector.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of the field." },
        text: { type: "string", description: "Text to type." },
      },
      required: ["selector", "text"],
    },
    run: (args): Promise<ToolResult> => backend.type(String(args.selector), String(args.text)),
  };

  const click: ToolDefinition = {
    name: "browser.click",
    description:
      "Click the first element matching a CSS selector. This is a consequential action (it can submit, send, or purchase), so it requires human approval.",
    parameters: {
      type: "object",
      properties: { selector: { type: "string", description: "CSS selector to click." } },
      required: ["selector"],
    },
    requiresApproval: true,
    run: (args): Promise<ToolResult> => backend.click(String(args.selector)),
  };

  const screenshot: ToolDefinition = {
    name: "browser.screenshot",
    description: "Capture a screenshot of the current page for inspection.",
    parameters: { type: "object", properties: {} },
    run: (): Promise<ToolResult> => backend.screenshot(),
  };

  return {
    tools: [goto, extract, type, click, screenshot],
    close: () => backend.close(),
  };
}

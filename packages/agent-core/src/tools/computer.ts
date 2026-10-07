import type { ToolDefinition, ToolResult } from "../types.js";

/**
 * Desktop computer-use backend: operate a real GUI by screenshot + input.
 *
 * `computer.click` is approval-gated (it can press buttons that send, pay, or
 * delete). Typing and keys are not gated in M3; they will get policy rules later.
 */
export interface ComputerBackend {
  screenshot(): Promise<ToolResult>;
  move(x: number, y: number): Promise<ToolResult>;
  click(x: number, y: number, button?: number): Promise<ToolResult>;
  type(text: string): Promise<ToolResult>;
  key(key: string): Promise<ToolResult>;
  scroll(amount: number): Promise<ToolResult>;
  /** Start/stop a screen recording (teach-by-demonstration). */
  record?(start: boolean): Promise<ToolResult>;
  /** Base URL of the live framebuffer stream, if the backend supports one. */
  streamUrl?(): Promise<string | null>;
  close(): Promise<void>;
}

export interface ComputerTools {
  tools: ToolDefinition[];
  close(): Promise<void>;
}

function requireNumber(value: unknown, name: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`"${name}" must be a number`);
  return parsed;
}

export function createComputerTools(backend: ComputerBackend): ComputerTools {
  const screenshot: ToolDefinition = {
    name: "computer.screenshot",
    description: "Capture a screenshot of the desktop to see what is currently on screen.",
    parameters: { type: "object", properties: {} },
    run: (): Promise<ToolResult> => backend.screenshot(),
  };

  const move: ToolDefinition = {
    name: "computer.move",
    description: "Move the mouse cursor to screen coordinates (x, y).",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number", description: "X coordinate in pixels." },
        y: { type: "number", description: "Y coordinate in pixels." },
      },
      required: ["x", "y"],
    },
    run: (args): Promise<ToolResult> => backend.move(requireNumber(args.x, "x"), requireNumber(args.y, "y")),
  };

  const click: ToolDefinition = {
    name: "computer.click",
    description:
      "Move the cursor to (x, y) and click. This is a consequential action (it can submit, confirm, or delete), so it requires human approval.",
    parameters: {
      type: "object",
      properties: {
        x: { type: "number", description: "X coordinate in pixels." },
        y: { type: "number", description: "Y coordinate in pixels." },
        button: { type: "number", description: "Mouse button (1 = left, 3 = right). Defaults to 1." },
      },
      required: ["x", "y"],
    },
    requiresApproval: true,
    run: (args): Promise<ToolResult> =>
      backend.click(
        requireNumber(args.x, "x"),
        requireNumber(args.y, "y"),
        args.button ? requireNumber(args.button, "button") : 1,
      ),
  };

  const type: ToolDefinition = {
    name: "computer.type",
    description: "Type text with the keyboard into the focused window.",
    parameters: {
      type: "object",
      properties: { text: { type: "string", description: "Text to type." } },
      required: ["text"],
    },
    run: (args): Promise<ToolResult> => backend.type(String(args.text)),
  };

  const key: ToolDefinition = {
    name: "computer.key",
    description: "Press a single key or key combination (e.g. Return, Tab, ctrl+c).",
    parameters: {
      type: "object",
      properties: { key: { type: "string", description: "Key name, e.g. Return or ctrl+l." } },
      required: ["key"],
    },
    run: (args): Promise<ToolResult> => backend.key(String(args.key)),
  };

  const scroll: ToolDefinition = {
    name: "computer.scroll",
    description: "Scroll the view: positive = down, negative = up.",
    parameters: {
      type: "object",
      properties: { amount: { type: "number", description: "Number of scroll steps." } },
    },
    run: (args): Promise<ToolResult> =>
      backend.scroll(args.amount ? requireNumber(args.amount, "amount") : 3),
  };

  return {
    tools: [screenshot, move, click, type, key, scroll],
    close: () => backend.close(),
  };
}

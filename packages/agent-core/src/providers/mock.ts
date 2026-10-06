import { randomUUID } from "node:crypto";
import type { AgentMessage, ModelProvider, ModelResponse, ToolSpec } from "../types.js";

/**
 * Keyless, deterministic provider.
 *
 * It does not "think" — it replays a fixed script while the real loop, tools,
 * approvals, and event stream do all the actual work. It picks a script from
 * the tools on offer, so the same mock drives browser use, computer use, code,
 * or any combination. Swap in a real provider with BOTIFYR_PROVIDER.
 */

interface ScriptedAction {
  tool: string;
  arguments?: Record<string, unknown>;
}

export function buildMockBrowserScript(demoUrl: string): ScriptedAction[] {
  return [
    { tool: "browser.goto", arguments: { url: demoUrl } },
    { tool: "browser.extract", arguments: { selector: "h1" } },
    { tool: "browser.type", arguments: { selector: "#name", text: "Botifyr" } },
    { tool: "browser.click", arguments: { selector: "#submit" } },
    { tool: "browser.extract", arguments: { selector: "#result" } },
  ];
}

export function buildMockComputerScript(): ScriptedAction[] {
  return [
    { tool: "computer.screenshot", arguments: {} },
    { tool: "computer.click", arguments: { x: 300, y: 150 } },
    { tool: "computer.type", arguments: { text: "echo hello from botifyr" } },
    { tool: "computer.key", arguments: { key: "Return" } },
    { tool: "computer.screenshot", arguments: {} },
  ];
}

export function buildMockCodeScript(): ScriptedAction[] {
  return [
    { tool: "shell.exec", arguments: { command: "node -e \"console.log('sandbox math:', 6 * 7)\"" } },
    {
      tool: "file.write",
      arguments: { path: "report.txt", content: "Botifyr ran in an isolated sandbox.\nSecond line.\n" },
    },
    { tool: "file.read", arguments: { path: "report.txt" } },
    { tool: "file.list", arguments: { path: "." } },
  ];
}

export function createMockProvider(demoUrl: string): ModelProvider {
  const browserScript = buildMockBrowserScript(demoUrl);
  const computerScript = buildMockComputerScript();
  const codeScript = buildMockCodeScript();

  return {
    name: "mock",
    async complete({
      messages,
      tools,
    }: {
      messages: AgentMessage[];
      tools: ToolSpec[];
    }): Promise<ModelResponse> {
      const usesComputer = tools.some((tool) => tool.name.startsWith("computer."));
      const usesShell = tools.some((tool) => tool.name.startsWith("shell."));
      const usesBrowser = tools.some((tool) => tool.name.startsWith("browser."));

      const script = usesComputer
        ? computerScript
        : usesShell
          ? codeScript
          : usesBrowser
            ? browserScript
            : [];

      if (script.length === 0) {
        return { text: "No tools are enabled for this agent.", toolCalls: [] };
      }

      const completed = messages.filter((message) => message.role === "tool").length;

      if (completed >= script.length) {
        const summary = usesComputer
          ? "Finished. I opened the desktop, focused the terminal, typed a command, and ran it."
          : usesShell
            ? "Finished. I ran code in an isolated sandbox, wrote a file, read it back, and listed the workspace."
            : "Finished. I opened the demo page, read its heading, filled the form, submitted it, and read the confirmation.";
        return { text: summary, toolCalls: [] };
      }

      const action = script[completed];
      return {
        reasoning: `Replaying scripted step ${completed + 1}/${script.length}`,
        toolCalls: [{ id: randomUUID(), name: action.tool, arguments: action.arguments ?? {} }],
      };
    },
  };
}

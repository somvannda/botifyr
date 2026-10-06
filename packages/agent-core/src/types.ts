/**
 * Core agent contracts. Deliberately model- and vendor-agnostic: providers,
 * tools, and the loop all speak these types, so nothing here depends on a
 * specific LLM or a specific capability (browser, computer, code...).
 */

export type RiskLevel = "low" | "medium" | "high";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema for the tool arguments. */
  parameters: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface ModelResponse {
  /** Free-form assistant text (final answer or reasoning). */
  text?: string;
  /** Optional short reasoning summary for the UI. */
  reasoning?: string;
  toolCalls: ToolCall[];
  /** Provider-reported token usage for this call, when available. */
  usage?: TokenUsage;
}

/** A provider-agnostic chat message. */
export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  toolName?: string;
}

export interface ModelProvider {
  readonly name: string;
  complete(input: {
    messages: AgentMessage[];
    tools: ToolSpec[];
    maxTokens?: number;
  }): Promise<ModelResponse>;
  /** Optional token streaming; when present the loop can surface live text. */
  completeStream?(
    input: { messages: AgentMessage[]; tools: ToolSpec[]; maxTokens?: number },
    onDelta: (text: string) => void,
  ): Promise<ModelResponse>;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  /** Optional PNG snapshot of the surface after the action. */
  screenshot?: Uint8Array;
}

export interface ToolContext {
  workspaceDir: string;
  onScreenshot?: (png: Uint8Array) => void;
  log: (message: string) => void;
}

export interface ToolDefinition extends ToolSpec {
  /**
   * If true, the loop asks a human before running this tool. May be a function
   * of the arguments for selective approval (e.g. allowlist safe commands).
   */
  requiresApproval?: boolean | ((args: Record<string, unknown>) => boolean);
  run(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
}

export type StepStatus = "running" | "done" | "failed" | "skipped";

export interface StepUpdate {
  id: string;
  title: string;
  detail?: string;
  status: StepStatus;
}

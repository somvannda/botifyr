import type { AgentMessage, ModelProvider, ModelResponse, TokenUsage, ToolCall, ToolSpec } from "../types.js";

/**
 * Any OpenAI-compatible chat-completions endpoint: OpenAI, OpenRouter,
 * DeepSeek, Groq, Together, or a local server (Ollama / LM Studio / vLLM).
 * That single adapter covers most of the model market, keeping Botifyr
 * model-agnostic by construction.
 */

export interface OpenAIProviderOptions {
  baseUrl: string;
  model: string;
  apiKey?: string;
  /**
   * Echo assistant `reasoning_content` back on every assistant turn. Required
   * by DeepSeek "thinking mode": it rejects a request whose replayed assistant
   * messages omit the field (an empty string is accepted). Other providers
   * reject the unknown field, so this stays opt-in.
   */
  echoReasoning?: boolean;
}

interface OpenAIChoiceMessage {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: Array<{
    id: string;
    function?: { name?: string; arguments?: string };
  }>;
}

function safeJson(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/**
 * Some DeepSeek thinking-mode endpoints reject an empty `reasoning_content`
 * when tools are present (notably a tool-call turn the model answered with no
 * reasoning). When `stubReasoning` is set we send a short placeholder instead
 * of an empty string, which satisfies the validator without polluting context.
 */
const REASONING_PLACEHOLDER = "(none)";

function toOpenAIMessage(
  message: AgentMessage,
  echoReasoning: boolean,
  stubReasoning = false,
): Record<string, unknown> {
  const reasoning = (): string | undefined =>
    message.reasoningContent || (stubReasoning ? REASONING_PLACEHOLDER : "");
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    const out: Record<string, unknown> = {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
    if (echoReasoning) out.reasoning_content = reasoning();
    return out;
  }
  if (message.role === "assistant" && echoReasoning) {
    return {
      role: "assistant",
      content: message.content || null,
      reasoning_content: reasoning(),
    };
  }
  return { role: message.role, content: message.content };
}

/**
 * DeepSeek thinking mode rejects `tool_choice: "required"`. When the caller
 * forces a tool call we fall back to "auto"; the agent already nudges the model
 * with a redirect message, so this only relaxes a hard constraint.
 */
function effectiveToolChoice(
  toolChoice: "auto" | "none" | "required" | undefined,
  echoReasoning: boolean,
): "auto" | "none" | "required" {
  if (echoReasoning && toolChoice === "required") return "auto";
  return toolChoice ?? "auto";
}

export function createOpenAIProvider(options: OpenAIProviderOptions): ModelProvider {
  const endpoint = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const echoReasoning = options.echoReasoning === true;

  /**
   * POST a chat-completions request. If thinking mode rejects the request
   * because a replayed assistant turn carried no reasoning (a zero-reasoning
   * tool-call turn), retry once with a non-empty reasoning placeholder.
   */
  async function post(messages: AgentMessage[], body: Record<string, unknown>): Promise<Response> {
    const send = (stubReasoning: boolean): Promise<Response> =>
      fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify({
          ...body,
          messages: messages.map((message) => toOpenAIMessage(message, echoReasoning, stubReasoning)),
        }),
      });
    const response = await send(false);
    if (response.ok) return response;
    const detail = await response.text();
    if (echoReasoning && /reasoning_content/i.test(detail)) {
      const retry = await send(true);
      if (retry.ok) return retry;
      const retryDetail = await retry.text();
      throw new Error(`model request failed (${retry.status}): ${retryDetail.slice(0, 500)}`);
    }
    throw new Error(`model request failed (${response.status}): ${detail.slice(0, 500)}`);
  }

  return {
    name: `openai-compatible:${options.model}`,
    async complete({
      messages,
      tools,
      maxTokens,
      toolChoice,
    }: {
      messages: AgentMessage[];
      tools: ToolSpec[];
      maxTokens?: number;
      toolChoice?: "auto" | "none" | "required";
    }): Promise<ModelResponse> {
      const body: Record<string, unknown> = {
        model: options.model,
        temperature: 0.2,
      };
      if (maxTokens && maxTokens > 0) body.max_tokens = maxTokens;

      // OpenAI-compatible APIs only allow [a-zA-Z0-9_-] in function names, so
      // dotted names like "browser.goto" are sanitized on the wire and mapped
      // back when the model calls them.
      const nameMap = new Map<string, string>();
      const toWireName = (name: string): string => {
        const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
        nameMap.set(safe, name);
        return safe;
      };

      if (tools.length > 0) {
        body.tools = tools.map((tool) => ({
          type: "function",
          function: {
            name: toWireName(tool.name),
            description: tool.description,
            parameters: tool.parameters,
          },
        }));
        body.tool_choice = effectiveToolChoice(toolChoice, echoReasoning);
      }

      const response = await post(messages, body);

      const json = (await response.json()) as {
        choices?: Array<{ message?: OpenAIChoiceMessage }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const message = json.choices?.[0]?.message ?? {};

      const toolCalls: ToolCall[] = (message.tool_calls ?? [])
        .filter((call) => call.function?.name)
        .map((call) => {
          const wireName = call.function?.name as string;
          return {
            id: call.id,
            name: nameMap.get(wireName) ?? wireName,
            arguments: safeJson(call.function?.arguments),
          };
        });

      return {
        text: message.content ?? undefined,
        reasoningContent: message.reasoning_content ?? undefined,
        toolCalls,
        usage: json.usage
          ? {
              promptTokens: json.usage.prompt_tokens ?? 0,
              completionTokens: json.usage.completion_tokens ?? 0,
            }
          : undefined,
      };
    },
    async completeStream({ messages, tools, maxTokens, toolChoice }, onDelta) {
      const body: Record<string, unknown> = {
        model: options.model,
        temperature: 0.2,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (maxTokens && maxTokens > 0) body.max_tokens = maxTokens;

      const nameMap = new Map<string, string>();
      const toWireName = (name: string): string => {
        const safe = name.replace(/[^a-zA-Z0-9_-]/g, "_");
        nameMap.set(safe, name);
        return safe;
      };
      if (tools.length > 0) {
        body.tools = tools.map((tool) => ({
          type: "function",
          function: {
            name: toWireName(tool.name),
            description: tool.description,
            parameters: tool.parameters,
          },
        }));
        body.tool_choice = effectiveToolChoice(toolChoice, echoReasoning);
      }

      const response = await post(messages, body);
      if (!response.body) {
        throw new Error(`model request failed (${response.status}): no response body`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
      let reasoning = "";
      let streamUsage: TokenUsage | undefined;
      const calls = new Map<number, { id: string; name: string; args: string }>();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          newline = buffer.indexOf("\n");
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          let chunk: {
            choices?: Array<{
              delta?: {
                content?: string | null;
                reasoning_content?: string | null;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
          try {
            chunk = JSON.parse(data);
          } catch {
            continue;
          }
          if (chunk.usage) {
            streamUsage = {
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              completionTokens: chunk.usage.completion_tokens ?? 0,
            };
          }
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;
          if (typeof delta.reasoning_content === "string" && delta.reasoning_content) {
            reasoning += delta.reasoning_content;
          }
          if (typeof delta.content === "string" && delta.content) {
            text += delta.content;
            onDelta(delta.content);
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const call of delta.tool_calls) {
              const index = call.index ?? 0;
              const existing = calls.get(index) ?? { id: "", name: "", args: "" };
              if (call.id) existing.id = call.id;
              if (call.function?.name) existing.name = call.function.name;
              if (call.function?.arguments) existing.args += call.function.arguments;
              calls.set(index, existing);
            }
          }
        }
      }

      return {
        text: text || undefined,
        reasoningContent: reasoning || undefined,
        toolCalls: [...calls.values()]
          .filter((call) => call.name)
          .map((call) => ({
            id: call.id,
            name: nameMap.get(call.name) ?? call.name,
            arguments: safeJson(call.args),
          })),
        usage: streamUsage,
      };
    },
  };
}

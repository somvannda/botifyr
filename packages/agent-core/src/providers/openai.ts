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
}

interface OpenAIChoiceMessage {
  content?: string | null;
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

function toOpenAIMessage(message: AgentMessage): Record<string, unknown> {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }
  return { role: message.role, content: message.content };
}

export function createOpenAIProvider(options: OpenAIProviderOptions): ModelProvider {
  const endpoint = `${options.baseUrl.replace(/\/$/, "")}/chat/completions`;

  return {
    name: `openai-compatible:${options.model}`,
    async complete({
      messages,
      tools,
      maxTokens,
    }: {
      messages: AgentMessage[];
      tools: ToolSpec[];
      maxTokens?: number;
    }): Promise<ModelResponse> {
      const body: Record<string, unknown> = {
        model: options.model,
        messages: messages.map(toOpenAIMessage),
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
        body.tool_choice = "auto";
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`model request failed (${response.status}): ${detail.slice(0, 500)}`);
      }

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
        toolCalls,
        usage: json.usage
          ? {
              promptTokens: json.usage.prompt_tokens ?? 0,
              completionTokens: json.usage.completion_tokens ?? 0,
            }
          : undefined,
      };
    },
    async completeStream({ messages, tools, maxTokens }, onDelta) {
      const body: Record<string, unknown> = {
        model: options.model,
        messages: messages.map(toOpenAIMessage),
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
        body.tool_choice = "auto";
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!response.ok || !response.body) {
        const detail = await response.text().catch(() => "");
        throw new Error(`model request failed (${response.status}): ${detail.slice(0, 500)}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let text = "";
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

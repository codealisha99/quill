// OpenAI-compatible chat-completions adapter (Ollama, OpenRouter, Groq, ...).
// Non-streaming: the full reply arrives at once and is emitted as one delta.
import type { Block, Message, ModelClient, ModelResponse, ToolSpec } from "../types.ts";

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export function toOpenAIMessages(system: string, messages: readonly Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [{ role: "system", content: system }];
  for (const m of messages) {
    const text = m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (m.role === "assistant") {
      const calls = m.content.flatMap((b) =>
        b.type === "tool_use"
          ? [{ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input) } }]
          : [],
      );
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    for (const b of m.content) {
      if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.tool_use_id, content: b.content });
    }
    if (text) out.push({ role: "user", content: text });
  }
  return out;
}

export function toOpenAITools(tools: readonly ToolSpec[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

interface ChatResponse {
  choices: { message: { content: string | null; tool_calls?: OpenAIMessage["tool_calls"] }; finish_reason: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function fromOpenAIResponse(json: ChatResponse): ModelResponse {
  const choice = json.choices[0];
  if (!choice) throw new Error("OpenAI-compatible response has no choices");
  const blocks: Block[] = [];
  if (choice.message.content) blocks.push({ type: "text", text: choice.message.content });
  for (const call of choice.message.tool_calls ?? []) {
    blocks.push({
      type: "tool_use",
      id: call.id,
      name: call.function.name,
      input: parseArgs(call.function.arguments),
    });
  }
  const hasCalls = blocks.some((b) => b.type === "tool_use");
  return {
    content: blocks,
    stopReason: hasCalls ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : "end_turn",
    usage: {
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    },
  };
}

function parseArgs(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw || "{}");
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`tool arguments must be a JSON object, got: ${raw}`);
  }
  return value as Record<string, unknown>;
}

export function createOpenAICompatibleClient(opts: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  fetchImpl?: typeof fetch;
}): ModelClient {
  const doFetch = opts.fetchImpl ?? fetch;
  return {
    async complete(request, onText): Promise<ModelResponse> {
      const res = await doFetch(`${opts.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: opts.model,
          max_tokens: request.maxTokens,
          messages: toOpenAIMessages(request.system, request.messages),
          ...(request.tools.length ? { tools: toOpenAITools(request.tools) } : {}),
        }),
      });
      if (!res.ok) throw new Error(`OpenAI-compatible API ${res.status}: ${await res.text()}`);
      const response = fromOpenAIResponse((await res.json()) as ChatResponse);
      const text = response.content.find((b) => b.type === "text");
      if (onText && text?.type === "text") onText(text.text);
      return response;
    },
  };
}

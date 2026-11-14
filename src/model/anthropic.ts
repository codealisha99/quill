import Anthropic from "@anthropic-ai/sdk";
import type { Block, Message, ModelClient, ModelResponse } from "../types.ts";

type SdkBlock = Anthropic.MessageParam["content"] extends string | infer B
  ? B extends readonly (infer E)[]
    ? E
    : never
  : never;

// Our blocks are a strict subset of the SDK's content-block params, so the
// mapping is a field-by-field copy rather than a cast.
export function toSdkMessages(messages: readonly Message[]): Anthropic.MessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b): SdkBlock => {
      switch (b.type) {
        case "text":
          return { type: "text", text: b.text };
        case "tool_use":
          return { type: "tool_use", id: b.id, name: b.name, input: { ...b.input } };
        case "tool_result":
          return {
            type: "tool_result",
            tool_use_id: b.tool_use_id,
            content: b.content,
            is_error: b.is_error ?? false,
          };
      }
    }),
  }));
}

export function fromSdkBlock(block: Anthropic.ContentBlock): Block[] {
  if (block.type === "text") return [{ type: "text", text: block.text }];
  if (block.type === "tool_use") {
    return [{ type: "tool_use", id: block.id, name: block.name, input: block.input as Record<string, unknown> }];
  }
  return []; // thinking and server-tool blocks are not used by quill
}

export function createAnthropicClient(opts: { apiKey?: string; model: string }): ModelClient {
  const client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
  return {
    async complete(request, onText): Promise<ModelResponse> {
      const stream = client.messages.stream({
        model: opts.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: toSdkMessages(request.messages),
        ...(request.tools.length > 0 ? { tools: request.tools.map((t) => ({ ...t })) } : {}),
      });
      if (onText) stream.on("text", onText);
      const message = await stream.finalMessage();
      return {
        content: message.content.flatMap(fromSdkBlock),
        stopReason: message.stop_reason === "tool_use"
          ? "tool_use"
          : message.stop_reason === "max_tokens"
            ? "max_tokens"
            : "end_turn",
        usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      };
    },
  };
}

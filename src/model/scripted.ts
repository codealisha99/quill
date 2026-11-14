// Deterministic fake model for tests and keyless demos. It replays queued
// replies in order. Summarizer calls (no tools offered) are answered from a
// separate reply so compaction does not consume the script.
import type { Block, ModelClient, ModelRequest, ModelResponse } from "../types.ts";
import { estimateTokens } from "../agent/budget.ts";

export interface ScriptedOptions {
  readonly summary?: string;
  readonly textChunkSize?: number;
}

export interface ScriptedModel extends ModelClient {
  readonly summarizerCalls: ModelRequest[];
  readonly remaining: number;
}

let nextId = 1;
export const toolUse = (name: string, input: Record<string, unknown>, id?: string): Block => ({
  type: "tool_use",
  id: id ?? `toolu_${nextId++}`,
  name,
  input,
});

export function reply(...blocks: Block[]): ModelResponse {
  const hasCall = blocks.some((b) => b.type === "tool_use");
  return {
    content: blocks,
    stopReason: hasCall ? "tool_use" : "end_turn",
    usage: { inputTokens: 0, outputTokens: 0 }, // filled in by the model on delivery
  };
}

export const say = (text: string): ModelResponse => reply({ type: "text", text });

export function createScriptedModel(
  script: readonly ModelResponse[],
  opts: ScriptedOptions = {},
): ScriptedModel {
  const queue = [...script];
  const summarizerCalls: ModelRequest[] = [];
  const chunk = opts.textChunkSize ?? 16;
  return {
    summarizerCalls,
    get remaining() {
      return queue.length;
    },
    async complete(request, onText): Promise<ModelResponse> {
      const isSummarizer = request.tools.length === 0 && request.system.includes("summarize");
      let response: ModelResponse;
      if (isSummarizer) {
        summarizerCalls.push(request);
        response = say(opts.summary ?? "Scripted summary of earlier work.");
      } else {
        const next = queue.shift();
        if (!next) throw new Error(`scripted model exhausted after ${summarizerCalls.length} summarizer calls`);
        response = next;
      }
      if (onText) {
        for (const b of response.content) {
          if (b.type !== "text") continue;
          for (let i = 0; i < b.text.length; i += chunk) onText(b.text.slice(i, i + chunk));
        }
      }
      const outputTokens = estimateTokens(response.content);
      return { ...response, usage: { inputTokens: estimateTokens({ s: request.system, m: request.messages, t: request.tools }), outputTokens } };
    },
  };
}

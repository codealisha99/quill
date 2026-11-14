import type { Block, Message, ModelClient, ModelResponse, ToolUseBlock, ToolResultBlock } from "../types.ts";
import type { Tool, ToolContext } from "../tools/tool.ts";
import { type ContextBudget, shouldCompact, truncateOutput, contextTokens } from "./budget.ts";
import { compactMessages } from "./compact.ts";

export const MAX_OUTPUT_TOKENS = 8192;

export type AgentEvent =
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "tool_call"; readonly id: string; readonly name: string; readonly input: Record<string, unknown> }
  | { readonly type: "tool_result"; readonly id: string; readonly name: string; readonly content: string; readonly isError: boolean }
  | { readonly type: "usage"; readonly turn: number; readonly inputTokens: number; readonly outputTokens: number; readonly contextTokens: number }
  | { readonly type: "compaction"; readonly before: number; readonly after: number; readonly summary: string }
  | { readonly type: "subagent"; readonly phase: "start" | "end"; readonly description: string }
  | { readonly type: "warning"; readonly message: string };

export interface AgentDeps {
  readonly model: ModelClient;
  readonly tools: readonly Tool[];
  readonly system: string;
  readonly budget: ContextBudget;
  readonly ctx: ToolContext;
  readonly emit: (event: AgentEvent) => void;
  readonly maxTurns?: number;
  readonly onMessage?: (message: Message) => void; // persistence hook
  readonly onCompact?: (messages: readonly Message[]) => void; // persistence hook
}

export interface AgentResult {
  readonly messages: Message[];
  readonly finalText: string;
}

export async function runAgent(
  history: readonly Message[],
  prompt: string,
  deps: AgentDeps,
): Promise<AgentResult> {
  const userMessage: Message = { role: "user", content: [{ type: "text", text: prompt }] };
  let messages = append(history, userMessage, deps.onMessage);
  const specs = deps.tools.map((t) => t.spec);
  const maxTurns = deps.maxTurns ?? 25;

  for (let turn = 1; turn <= maxTurns; turn++) {
    messages = await maybeCompact(messages, deps);
    const response = await deps.model.complete(
      { system: deps.system, messages, tools: specs, maxTokens: MAX_OUTPUT_TOKENS },
      (text) => deps.emit({ type: "text_delta", text }),
    );
    deps.emit(usageEvent(turn, deps.system, messages, response));
    const assistant: Message = { role: "assistant", content: response.content };
    messages = append(messages, assistant, deps.onMessage);

    const calls = response.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (calls.length === 0) return { messages, finalText: textOf(response.content) };

    // All calls from one assistant message run concurrently; results keep call order.
    const results = await Promise.all(calls.map((c) => runToolCall(c, deps)));
    messages = append(messages, { role: "user", content: results }, deps.onMessage);
  }
  throw new Error(`agent stopped after ${maxTurns} turns without a final answer`);
}

async function maybeCompact(messages: readonly Message[], deps: AgentDeps): Promise<Message[]> {
  if (!shouldCompact(deps.system, messages, deps.budget)) return [...messages];
  const before = contextTokens(deps.system, messages);
  const result = await compactMessages(messages, deps.model);
  if (!result) {
    deps.emit({ type: "warning", message: "context is over budget but there is nothing old enough to compact" });
    return [...messages];
  }
  const after = contextTokens(deps.system, result.messages);
  deps.emit({ type: "compaction", before, after, summary: result.summary });
  deps.onCompact?.(result.messages);
  return result.messages;
}

async function runToolCall(call: ToolUseBlock, deps: AgentDeps): Promise<ToolResultBlock> {
  deps.emit({ type: "tool_call", id: call.id, name: call.name, input: call.input });
  const result = await executeTool(call, deps);
  const content = truncateOutput(result.content, deps.budget.maxToolOutputChars);
  deps.emit({ type: "tool_result", id: call.id, name: call.name, content, isError: result.isError });
  return { type: "tool_result", tool_use_id: call.id, content, ...(result.isError ? { is_error: true } : {}) };
}

async function executeTool(
  call: ToolUseBlock,
  deps: AgentDeps,
): Promise<{ content: string; isError: boolean }> {
  const tool = deps.tools.find((t) => t.spec.name === call.name);
  if (!tool) return { content: `unknown tool: ${call.name}`, isError: true };
  try {
    const question = tool.describePermission?.(call.input);
    if (question !== undefined && !(await deps.ctx.ask(question))) {
      return { content: `permission denied by user: ${question}`, isError: true };
    }
    const out = await tool.run(call.input, deps.ctx);
    return { content: out.content, isError: out.isError === true };
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}

function usageEvent(turn: number, system: string, messages: readonly Message[], r: ModelResponse): AgentEvent {
  return {
    type: "usage",
    turn,
    inputTokens: r.usage.inputTokens,
    outputTokens: r.usage.outputTokens,
    contextTokens: contextTokens(system, messages),
  };
}

function append(messages: readonly Message[], m: Message, hook?: (m: Message) => void): Message[] {
  hook?.(m);
  return [...messages, m];
}

export function textOf(content: readonly Block[]): string {
  return content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
}

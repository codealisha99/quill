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
    if (response.stopReason === "max_tokens") {
      // A cut-off reply is not an answer, and its tool calls may be incomplete, so none run.
      messages = append(messages, cutOffFollowUp(calls, deps), deps.onMessage);
      continue;
    }
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

const CUT_OFF_NOTE = "the reply hit the output limit before this tool call was complete; it was not run. Retry with a smaller call.";

// Keeps every tool_use paired (the provider rejects a broken pairing), then asks for the rest.
function cutOffFollowUp(calls: readonly ToolUseBlock[], deps: AgentDeps): Message {
  deps.emit({ type: "warning", message: "a reply hit the output limit; asking the model to continue" });
  if (calls.length === 0) {
    const text = "Your previous reply was cut off at the output limit. Continue from where it stopped.";
    return { role: "user", content: [{ type: "text", text }] };
  }
  const content = calls.map((call) => {
    deps.emit({ type: "tool_result", id: call.id, name: call.name, content: CUT_OFF_NOTE, isError: true });
    return { type: "tool_result" as const, tool_use_id: call.id, content: CUT_OFF_NOTE, is_error: true };
  });
  return { role: "user", content };
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
  if (call.invalidInput) {
    const error = call.invalidInput.error;
    return { content: `tool arguments are not valid JSON (${error}). Send a JSON object that matches the tool's schema.`, isError: true };
  }
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

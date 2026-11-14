import type { Message } from "../types.ts";

export interface ContextBudget {
  readonly contextTokens: number; // hard budget for the request context
  readonly compactRatio: number; // compact once estimated usage exceeds this fraction
  readonly maxToolOutputChars: number; // per tool result, before head+tail truncation
}

export const DEFAULT_BUDGET: ContextBudget = {
  contextTokens: 150_000,
  compactRatio: 0.8,
  maxToolOutputChars: 20_000,
};

// Heuristic: ~4 characters per token. Used for the pre-call compaction decision;
// the provider's reported usage is recorded separately for accounting.
export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

export function contextTokens(system: string, messages: readonly Message[]): number {
  return estimateTokens({ system, messages });
}

export function shouldCompact(system: string, messages: readonly Message[], budget: ContextBudget): boolean {
  return contextTokens(system, messages) > budget.contextTokens * budget.compactRatio;
}

// Keeps the head and tail of an oversized string, which is where errors and
// final lines usually live. The marker says how much was dropped.
export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.6);
  const tail = maxChars - head;
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n... [${omitted} chars truncated] ...\n${text.slice(text.length - tail)}`;
}

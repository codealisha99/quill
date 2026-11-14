import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentEvent } from "../src/agent/loop.ts";
import type { ContextBudget } from "../src/agent/budget.ts";
import { DEFAULT_BUDGET } from "../src/agent/budget.ts";
import type { ToolContext } from "../src/tools/tool.ts";

export function tempWorkspace(files: Record<string, string> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "quill-test-"));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

export function collector(): { events: AgentEvent[]; emit: (e: AgentEvent) => void } {
  const events: AgentEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

export function ctxFor(root: string, approve: boolean | ((q: string) => boolean) = true): ToolContext {
  const decide = typeof approve === "function" ? approve : () => approve;
  return { root, ask: async (q) => decide(q) };
}

export const roomyBudget: ContextBudget = { ...DEFAULT_BUDGET, contextTokens: 1_000_000 };

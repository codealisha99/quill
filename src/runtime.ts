import type { Message, ModelClient } from "./types.ts";
import type { AgentDeps, AgentEvent } from "./agent/loop.ts";
import type { ContextBudget } from "./agent/budget.ts";
import { buildSystemPrompt } from "./agent/prompt.ts";
import { makeSubagentRunner } from "./agent/subagent.ts";
import { makeTaskTool } from "./tools/task.ts";
import { READ_ONLY_TOOLS, WORKSPACE_TOOLS } from "./tools/index.ts";

export interface RuntimeOptions {
  readonly root: string;
  readonly model: ModelClient;
  readonly subagentModel?: ModelClient; // defaults to the main model
  readonly budget: ContextBudget;
  readonly maxTurns: number;
  readonly instructions?: string;
  readonly ask: (question: string) => Promise<boolean>;
  readonly emit: (event: AgentEvent) => void;
}

export interface Hooks {
  readonly onMessage?: (message: Message) => void;
  readonly onCompact?: (messages: readonly Message[]) => void;
}

// Wires the loop with the full tool set. Sub-agents get read-only tools and no
// task tool, so the tree stays one level deep.
export function buildAgentDeps(opts: RuntimeOptions, hooks: Hooks = {}): AgentDeps {
  const system = buildSystemPrompt(opts.root, opts.instructions);
  const runChild = makeSubagentRunner({
    model: opts.subagentModel ?? opts.model,
    tools: READ_ONLY_TOOLS,
    system,
    budget: opts.budget,
    root: opts.root,
    emit: opts.emit,
  });
  return {
    model: opts.model,
    tools: [...WORKSPACE_TOOLS, makeTaskTool(runChild)],
    system,
    budget: opts.budget,
    ctx: { root: opts.root, ask: opts.ask },
    emit: opts.emit,
    maxTurns: opts.maxTurns,
    ...hooks,
  };
}

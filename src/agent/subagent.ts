import type { ModelClient } from "../types.ts";
import type { Tool } from "../tools/tool.ts";
import type { SubagentRunner } from "../tools/task.ts";
import type { AgentEvent } from "./loop.ts";
import { runAgent } from "./loop.ts";
import type { ContextBudget } from "./budget.ts";

export const SUBAGENT_MAX_TURNS = 12;

export interface SubagentOptions {
  readonly model: ModelClient;
  readonly tools: readonly Tool[];
  readonly system: string;
  readonly budget: ContextBudget;
  readonly root: string;
  readonly emit: (event: AgentEvent) => void;
}

// Each child starts from an empty history, cannot ask for permission (it denies
// everything), and reports back only its final text. Children do not get the
// task tool, so recursion is impossible.
export function makeSubagentRunner(opts: SubagentOptions): SubagentRunner {
  return async (description, prompt) => {
    opts.emit({ type: "subagent", phase: "start", description });
    const result = await runAgent([], prompt, {
      model: opts.model,
      tools: opts.tools,
      system: opts.system,
      budget: opts.budget,
      ctx: { root: opts.root, ask: async () => false },
      emit: () => undefined,
      maxTurns: SUBAGENT_MAX_TURNS,
    });
    opts.emit({ type: "subagent", phase: "end", description });
    return result.finalText || "(sub-agent returned no text)";
  };
}

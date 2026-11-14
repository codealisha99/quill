import type { Tool, ToolOutput } from "./tool.ts";
import { requireString } from "./tool.ts";

export const TASK_TOOL_NAME = "task";

// The runner is injected so this file does not depend on the loop: it receives
// a description and prompt and resolves with the child's final report only.
export type SubagentRunner = (description: string, prompt: string) => Promise<string>;

export function makeTaskTool(runChild: SubagentRunner): Tool {
  return {
    spec: {
      name: TASK_TOOL_NAME,
      description:
        "Delegate a self-contained investigation to a sub-agent with a fresh context and read-only tools (read, grep, glob). " +
        "Only its final report comes back, so ask for a concise answer. Several task calls in one message run in parallel.",
      input_schema: {
        type: "object",
        properties: {
          description: { type: "string", description: "Short label for the sub-task." },
          prompt: { type: "string", description: "Complete instructions; the sub-agent sees nothing else." },
        },
        required: ["description", "prompt"],
      },
    },
    async run(input): Promise<ToolOutput> {
      const description = requireString(input, "description");
      const prompt = requireString(input, "prompt");
      return { content: await runChild(description, prompt) };
    },
  };
}

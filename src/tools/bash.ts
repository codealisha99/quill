import type { Tool, ToolOutput } from "./tool.ts";
import { optionalNumber, requireString } from "./tool.ts";

export const DEFAULT_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 600_000;

export const bashTool: Tool = {
  spec: {
    name: "bash",
    description:
      "Run a shell command with the workspace as cwd. Returns stdout, stderr and exit code. Killed after timeout_ms.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: { type: "number", description: `Default ${DEFAULT_TIMEOUT_MS}, max ${MAX_TIMEOUT_MS}.` },
      },
      required: ["command"],
    },
  },
  describePermission: (input) => `run: ${String(input.command)}`,
  async run(input, ctx): Promise<ToolOutput> {
    const command = requireString(input, "command");
    const timeout = Math.min(optionalNumber(input, "timeout_ms") ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const proc = Bun.spawn(["bash", "-c", command], {
      cwd: ctx.root,
      stdout: "pipe",
      stderr: "pipe",
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    // ponytail: killing bash does not stop children that still hold the pipes; we stop waiting at the deadline instead. Upgrade path: kill the whole process group.
    const expired = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        proc.kill();
        resolve("timeout");
      }, timeout);
    });
    const finished = Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    try {
      const outcome = await Promise.race([finished, expired]);
      if (outcome === "timeout") {
        return { content: `[timed out after ${timeout}ms]`, isError: true };
      }
      const [stdout, stderr, code] = outcome;
      const parts = [stdout, stderr && `[stderr]\n${stderr}`].filter(Boolean);
      return { content: `${parts.join("\n")}\n[exit code ${code}]`.trim(), isError: code !== 0 };
    } finally {
      clearTimeout(timer);
    }
  },
};

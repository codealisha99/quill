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
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill();
    }, timeout);
    try {
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const code = await proc.exited;
      const parts = [stdout, stderr && `[stderr]\n${stderr}`].filter(Boolean);
      const status = timedOut ? `timed out after ${timeout}ms` : `exit code ${code}`;
      return { content: `${parts.join("\n")}\n[${status}]`.trim(), isError: timedOut || code !== 0 };
    } finally {
      clearTimeout(timer);
    }
  },
};

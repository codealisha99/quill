import type { AgentEvent } from "../agent/loop.ts";

const COLORS = { dim: "\x1b[2m", red: "\x1b[31m", yellow: "\x1b[33m", cyan: "\x1b[36m", reset: "\x1b[0m" };
const PREVIEW_LINES = 3;

export interface Renderer {
  readonly emit: (event: AgentEvent) => void;
}

// Renders agent events as a terminal transcript. Colour is off when not a TTY.
export function createRenderer(write: (s: string) => void, color: boolean): Renderer {
  const c = (name: keyof typeof COLORS, s: string) => (color ? `${COLORS[name]}${s}${COLORS.reset}` : s);
  return {
    emit(event) {
      switch (event.type) {
        case "text_delta":
          write(event.text);
          return;
        case "tool_call":
          write(`\n${c("cyan", "●")} ${event.name} ${c("dim", summarizeInput(event.input))}\n`);
          return;
        case "tool_result": {
          const lines = event.content.split("\n");
          const preview = lines.slice(0, PREVIEW_LINES).join("\n  ");
          const more = lines.length > PREVIEW_LINES ? c("dim", `\n  … ${lines.length - PREVIEW_LINES} more lines`) : "";
          const body = event.isError ? c("red", `  ${preview}`) : c("dim", `  ${preview}`);
          write(`${body}${more}\n`);
          return;
        }
        case "usage":
          write(c("dim", `\n[turn ${event.turn}: in ${event.inputTokens} out ${event.outputTokens} · context ~${event.contextTokens} tok]\n`));
          return;
        case "compaction":
          write(c("yellow", `\n⟳ compacted context: ~${event.before} → ~${event.after} tokens\n`));
          return;
        case "subagent":
          write(c("cyan", `\n↳ sub-agent ${event.phase === "start" ? "started" : "finished"}: ${event.description}\n`));
          return;
        case "warning":
          write(c("yellow", `\n! ${event.message}\n`));
          return;
      }
    },
  };
}

export function summarizeInput(input: Record<string, unknown>): string {
  const text = JSON.stringify(input);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

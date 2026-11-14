import { parseArgs } from "node:util";
import path from "node:path";
import { DEFAULT_BUDGET, type ContextBudget } from "./agent/budget.ts";

export interface Config {
  readonly workspace: string;
  readonly prompt?: string; // one-shot mode when set
  readonly yes: boolean; // auto-approve permission prompts
  readonly resume: "latest" | string | undefined;
  readonly budget: ContextBudget;
  readonly maxTurns: number;
}

export const USAGE = `usage: quill [options]
  -p, --print <task>       run one task non-interactively and exit
  -y, --yes                approve bash/write/edit without asking
  -r, --resume [file]      continue the latest session in .quill/sessions, or the given file
  -w, --workspace <dir>    workspace root (default: current directory)
      --context-tokens <n> context budget in tokens (default ${DEFAULT_BUDGET.contextTokens}, env QUILL_CONTEXT_TOKENS)
      --max-tool-chars <n> truncate tool output beyond this many chars
      --max-turns <n>      model turns per user request (default 25)
  -h, --help               show this help`;

export class ConfigError extends Error {}

export function parseConfig(argv: readonly string[], env: Record<string, string | undefined>): Config {
  const { values } = parseFlags(argv);
  if (values.help) throw new ConfigError(USAGE);
  const contextTokens = positiveInt(values["context-tokens"] ?? env.QUILL_CONTEXT_TOKENS ?? String(DEFAULT_BUDGET.contextTokens), "--context-tokens");
  const maxToolChars = positiveInt(values["max-tool-chars"] ?? String(DEFAULT_BUDGET.maxToolOutputChars), "--max-tool-chars");
  const maxTurns = positiveInt(values["max-turns"] ?? "25", "--max-turns");
  return {
    workspace: path.resolve(values.workspace ?? process.cwd()),
    prompt: values.print,
    yes: values.yes === true,
    resume: values.resume,
    budget: { ...DEFAULT_BUDGET, contextTokens, maxToolOutputChars: maxToolChars },
    maxTurns,
  };
}

function parseFlags(argv: readonly string[]) {
  try {
    return parseArgs({
      args: withResumeDefault(argv),
      allowPositionals: true,
      strict: true,
      options: {
        print: { type: "string", short: "p" },
        yes: { type: "boolean", short: "y" },
        resume: { type: "string", short: "r" },
        workspace: { type: "string", short: "w" },
        "context-tokens": { type: "string" },
        "max-tool-chars": { type: "string" },
        "max-turns": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    throw new ConfigError(err instanceof Error ? err.message : String(err));
  }
}

// Lets a bare "--resume" (no value, or followed by another flag) mean "latest".
export function withResumeDefault(argv: readonly string[]): string[] {
  return argv.flatMap((arg, i) => {
    if (arg !== "--resume" && arg !== "-r") return [arg];
    const next = argv[i + 1];
    return next === undefined || next.startsWith("-") ? [arg, "latest"] : [arg];
  });
}

function positiveInt(raw: string, flag: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new ConfigError(`${flag} must be a positive integer, got "${raw}"`);
  return n;
}

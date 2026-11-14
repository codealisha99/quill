#!/usr/bin/env bun
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { parseConfig, ConfigError, USAGE, type Config } from "./config.ts";
import { runAgent } from "./agent/loop.ts";
import { loadProjectInstructions } from "./agent/prompt.ts";
import { selectModel } from "./model/select.ts";
import { buildAgentDeps } from "./runtime.ts";
import { appendRecord, latestSessionFile, loadSession, newSessionFile } from "./session/store.ts";
import { makeAsker, type Question } from "./ui/permissions.ts";
import { createRenderer } from "./ui/render.ts";
import type { Message } from "./types.ts";

export async function main(argv: string[], env: Record<string, string | undefined>): Promise<number> {
  let config: Config;
  try {
    config = parseConfig(argv, env);
  } catch (err) {
    if (err instanceof ConfigError) {
      const isHelp = err.message === USAGE;
      (isHelp ? console.log : console.error)(isHelp ? err.message : `quill: ${err.message}\n${USAGE}`);
      return isHelp ? 0 : 2;
    }
    throw err;
  }

  // Checked before anything is created: a session directory must never appear under a typo'd path.
  if (!isDirectory(config.workspace)) {
    console.error(`quill: workspace is not a directory: ${config.workspace}`);
    return 2;
  }

  let model;
  try {
    model = selectModel(env);
  } catch (err) {
    console.error(`quill: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  const sessionFile = resolveSession(config);
  if (sessionFile === undefined) {
    console.error("quill: no session to resume in .quill/sessions");
    return 1;
  }
  let history: Message[] = [];
  try {
    history = config.resume ? loadSession(sessionFile) : [];
  } catch (err) {
    console.error(`quill: cannot read session ${sessionFile}: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  // The REPL and TTY-backed prompts share one readline interface; piped stdin works too.
  const rl = config.prompt === undefined || process.stdin.isTTY
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : undefined;
  const question: Question | undefined = rl ? (text) => rl.question(text) : undefined;
  const ask = makeAsker(config.yes ? "auto-approve" : rl ? "prompt" : "deny", question);
  const renderer = createRenderer((s) => process.stdout.write(s), process.stdout.isTTY === true);

  const deps = buildAgentDeps(
    {
      root: config.workspace,
      model,
      budget: config.budget,
      maxTurns: config.maxTurns,
      instructions: loadProjectInstructions(config.workspace),
      ask,
      emit: renderer.emit,
    },
    {
      onMessage: (m) => appendRecord(sessionFile, { kind: "message", message: m }),
      onCompact: (ms) => appendRecord(sessionFile, { kind: "compaction", messages: ms }),
    },
  );

  try {
    if (config.prompt !== undefined) {
      await runAgent(history, config.prompt, deps);
      process.stdout.write("\n");
      return 0;
    }
    return rl ? await repl(rl, history, deps) : 2;
  } catch (err) {
    console.error(`\nquill: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  } finally {
    rl?.close();
  }
}

async function repl(
  rl: readline.Interface,
  history: Message[],
  deps: ReturnType<typeof buildAgentDeps>,
): Promise<number> {
  console.log("quill: type a request, /exit to quit");
  let current = history;
  for (;;) {
    const line = await nextLine(rl);
    if (line === undefined || line === "/exit") return 0;
    if (line === "") continue;
    try {
      current = (await runAgent(current, line, deps)).messages;
    } catch (err) {
      console.error(`\nquill: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Resolves undefined when stdin closes (Ctrl-D or end of piped input).
async function nextLine(rl: readline.Interface): Promise<string | undefined> {
  try {
    return (await rl.question("quill> ")).trim();
  } catch {
    return undefined;
  }
}

// --resume picks the newest session file; a path resumes that file; otherwise a new one.
function resolveSession(config: Config): string | undefined {
  if (config.resume === "latest") return latestSessionFile(config.workspace);
  if (config.resume) return path.resolve(config.resume);
  return newSessionFile(config.workspace);
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}

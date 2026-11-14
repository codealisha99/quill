// Keyless demo of context compaction. A four-request session runs against a
// deliberately tiny budget so the loop must summarise older turns, while the
// transcript keeps valid tool_use/tool_result pairing throughout.
import fs from "node:fs";
import { runAgent } from "../src/agent/loop.ts";
import { checkPairing } from "../src/agent/pairing.ts";
import { createScriptedModel, reply, say, toolUse } from "../src/model/scripted.ts";
import { buildAgentDeps } from "../src/runtime.ts";
import { createRenderer } from "../src/ui/render.ts";
import type { Message } from "../src/types.ts";
import { makeFixture } from "./fixture.ts";

const TINY_BUDGET = { contextTokens: 1200, compactRatio: 0.8, maxToolOutputChars: 400 };
const REQUESTS = ["Read the release notes.", "Now read them again and list the risky items.", "Check the changelog too.", "Summarise everything so far."];

const logLines = Array.from({ length: 300 }, (_, i) => `2026-11-${String((i % 28) + 1).padStart(2, "0")} event ${i}: service handled request, latency ${i % 97}ms`).join("\n");

function script(i: number) {
  return [
    reply({ type: "text", text: `Step ${i + 1}: reading notes/release.log.` }, toolUse("read", { path: "notes/release.log" }, `r${i}`)),
    say(`Step ${i + 1} done.`),
  ];
}

async function main(): Promise<number> {
  const root = makeFixture("quill-compaction-", { "notes/release.log": logLines });
  try {
    console.log(`fixture repo: ${root}`);
    console.log(`budget: ${TINY_BUDGET.contextTokens} tokens, compacts above ${TINY_BUDGET.contextTokens * TINY_BUDGET.compactRatio}; tool output capped at ${TINY_BUDGET.maxToolOutputChars} chars\n`);

    const model = createScriptedModel(
      REQUESTS.flatMap((_, i) => script(i)),
      { summary: "Earlier requests: the agent read notes/release.log (300 log lines, mostly routine latency events). No risky items found yet." },
    );
    const renderer = createRenderer((s) => process.stdout.write(s), process.stdout.isTTY === true);
    const snapshots: Message[][] = [];
    const deps = buildAgentDeps(
      {
        root,
        model,
        budget: TINY_BUDGET,
        maxTurns: 6,
        ask: async () => true,
        emit: renderer.emit,
      },
      { onCompact: (ms) => snapshots.push([...ms]) },
    );

    let history: Message[] = [];
    for (const [i, request] of REQUESTS.entries()) {
      console.log(`\n=== request ${i + 1}: ${request}`);
      history = (await runAgent(history, request, deps)).messages;
      console.log(`transcript messages: ${history.length}, pairing: ${checkPairing(history).length === 0 ? "valid" : "BROKEN"}`);
    }

    const compactions = snapshots.length;
    const allValid = snapshots.every((s) => checkPairing(s).length === 0);
    console.log(`\n--- summary ---`);
    console.log(`compactions triggered: ${compactions}`);
    console.log(`summarizer calls made: ${model.summarizerCalls.length}`);
    console.log(`every compacted snapshot pairing-valid: ${allValid}`);
    console.log(`final transcript pairing-valid: ${checkPairing(history).length === 0}`);
    if (compactions === 0 || !allValid || checkPairing(history).length > 0) return 1;
    return 0;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

process.exitCode = await main();

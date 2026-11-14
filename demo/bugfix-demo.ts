// Keyless end-to-end demo: the real agent loop and real tools, driven by a
// scripted model. The agent delegates a map to a sub-agent, reads the failing
// test and code, runs the tests, edits the bug, and re-runs the tests.
import fs from "node:fs";
import { runAgent } from "../src/agent/loop.ts";
import { checkPairing } from "../src/agent/pairing.ts";
import { DEFAULT_BUDGET } from "../src/agent/budget.ts";
import { createScriptedModel, reply, say, toolUse } from "../src/model/scripted.ts";
import { buildAgentDeps } from "../src/runtime.ts";
import { createRenderer } from "../src/ui/render.ts";
import { makeFixture, runTests } from "./fixture.ts";

const FIXTURE = {
  "package.json": JSON.stringify({ name: "fixture-stats", type: "module" }, null, 2),
  "src/mean.ts":
    "export function mean(xs: number[]): number {\n" +
    "  let sum = 0;\n" +
    "  for (let i = 1; i < xs.length; i++) sum += xs[i];\n" +
    "  return sum / xs.length;\n" +
    "}\n",
  "test/mean.test.ts":
    'import { expect, test } from "bun:test";\n' +
    'import { mean } from "../src/mean";\n\n' +
    'test("mean averages all values", () => {\n' +
    "  expect(mean([2, 4, 6])).toBe(4);\n" +
    "});\n",
};

const SUB_AGENT_SCRIPT = [
  reply(toolUse("glob", { pattern: "**/*.ts" }, "s1")),
  say("Two TypeScript files: src/mean.ts (mean function) and test/mean.test.ts (one test for mean)."),
];

const MAIN_SCRIPT = [
  reply(
    { type: "text", text: "I'll map the repo with a sub-agent and read the failing test in parallel." },
    toolUse("task", { description: "map repo", prompt: "List the TypeScript files in this workspace and summarise them in two lines." }, "m1"),
    toolUse("read", { path: "test/mean.test.ts" }, "m2"),
  ),
  reply(toolUse("read", { path: "src/mean.ts" }, "m3")),
  reply({ type: "text", text: "Running the test suite to confirm the failure." }, toolUse("bash", { command: "bun test" }, "m4")),
  reply(
    { type: "text", text: "The loop starts at index 1, so the first element is skipped. Fixing it." },
    toolUse("edit", { path: "src/mean.ts", old_string: "for (let i = 1;", new_string: "for (let i = 0;" }, "m5"),
  ),
  reply(toolUse("bash", { command: "bun test" }, "m6")),
  say("Fixed src/mean.ts: the loop started at index 1 and skipped the first value. The test suite passes."),
];

async function main(): Promise<number> {
  const root = makeFixture("quill-bugfix-", FIXTURE);
  try {
    console.log(`fixture repo: ${root}`);
    const before = await runTests(root);
    console.log(`tests before the agent runs: ${before.passed ? "PASS" : "FAIL"}\n`);
    if (before.passed) throw new Error("fixture should start with a failing test");

    const renderer = createRenderer((s) => process.stdout.write(s), process.stdout.isTTY === true);
    const deps = buildAgentDeps({
      root,
      model: createScriptedModel(MAIN_SCRIPT),
      subagentModel: createScriptedModel(SUB_AGENT_SCRIPT),
      budget: DEFAULT_BUDGET,
      maxTurns: 10,
      ask: async (q) => (console.log(`\n? ${q} -> yes (demo auto-approves)`), true),
      emit: renderer.emit,
    });

    console.log("--- agent run ---");
    const result = await runAgent([], "The test in test/mean.test.ts fails. Find the bug, fix it and make the tests pass.", deps);
    console.log("\n--- agent final answer ---");
    console.log(result.finalText);

    const problems = checkPairing(result.messages);
    const after = await runTests(root);
    const src = fs.readFileSync(`${root}/src/mean.ts`, "utf8");
    console.log(`\ntranscript pairing: ${problems.length === 0 ? "valid" : problems.join("; ")}`);
    console.log(`tests after the agent runs: ${after.passed ? "PASS" : "FAIL"}`);
    console.log(`src/mean.ts fixed: ${src.includes("for (let i = 0;") ? "yes" : "no"}`);
    if (!after.passed || problems.length > 0) {
      console.log(after.output);
      return 1;
    }
    return 0;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

process.exitCode = await main();

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runAgent } from "../src/agent/loop.ts";
import { checkPairing } from "../src/agent/pairing.ts";
import { createScriptedModel, reply, say, toolUse } from "../src/model/scripted.ts";
import { WORKSPACE_TOOLS } from "../src/tools/index.ts";
import { buildAgentDeps } from "../src/runtime.ts";
import type { Message } from "../src/types.ts";
import { collector, ctxFor, roomyBudget, tempWorkspace } from "./helpers.ts";

const deps = (root: string, model: ReturnType<typeof createScriptedModel>, opts: { approve?: boolean; budget?: typeof roomyBudget } = {}) => {
  const c = collector();
  const d = buildAgentDeps({
    root,
    model,
    budget: opts.budget ?? roomyBudget,
    maxTurns: 10,
    ask: async () => opts.approve ?? true,
    emit: c.emit,
  });
  return { d, events: c.events };
};

describe("agent loop", () => {
  test("runs tool call -> result -> final answer, streams text, and keeps pairing valid", async () => {
    const root = tempWorkspace({ "a.txt": "hello from a" });
    const model = createScriptedModel([
      reply({ type: "text", text: "Reading the file." }, toolUse("read", { path: "a.txt" }, "t1")),
      say("The file says hello."),
    ], { textChunkSize: 4 });
    const { d, events } = deps(root, model);
    const result = await runAgent([], "what is in a.txt?", d);

    expect(result.finalText).toBe("The file says hello.");
    expect(checkPairing(result.messages)).toEqual([]);
    const toolResult = result.messages[2]?.content[0];
    expect(toolResult).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
    expect(events.filter((e) => e.type === "text_delta").length).toBeGreaterThan(2); // streamed in chunks
    expect(events.some((e) => e.type === "usage" && e.turn === 1)).toBe(true);
  });

  test("unknown tools and thrown errors become error results instead of crashing the loop", async () => {
    const root = tempWorkspace();
    const model = createScriptedModel([
      reply(toolUse("teleport", {}, "t1"), toolUse("read", { path: "missing.txt" }, "t2")),
      say("handled"),
    ]);
    const { d } = deps(root, model);
    const result = await runAgent([], "go", d);
    const results = result.messages[2]?.content;
    expect(results?.[0]).toMatchObject({ tool_use_id: "t1", is_error: true });
    expect(results?.[1]).toMatchObject({ tool_use_id: "t2", is_error: true });
    expect(checkPairing(result.messages)).toEqual([]);
  });

  test("a denied permission prevents the write and tells the model", async () => {
    const root = tempWorkspace();
    const model = createScriptedModel([
      reply(toolUse("write", { path: "x.txt", content: "nope" }, "t1")),
      say("ok, skipped"),
    ]);
    const { d } = deps(root, model, { approve: false });
    const result = await runAgent([], "write it", d);
    expect(fs.existsSync(path.join(root, "x.txt"))).toBe(false);
    expect(result.messages[2]?.content[0]).toMatchObject({ is_error: true });
    expect(JSON.stringify(result.messages[2])).toContain("permission denied");
  });

  test("oversized tool output is truncated before it reaches the model", async () => {
    const root = tempWorkspace({ "big.txt": "x".repeat(10_000) });
    const model = createScriptedModel([reply(toolUse("read", { path: "big.txt" }, "t1")), say("done")]);
    const { d } = deps(root, model, { budget: { ...roomyBudget, maxToolOutputChars: 500 } });
    const result = await runAgent([], "read", d);
    const content = result.messages[2]?.content[0];
    expect(content?.type === "tool_result" && content.content.length).toBeLessThan(700);
    expect(JSON.stringify(result.messages[2])).toContain("truncated");
  });

  test("persistence hooks see every message in order", async () => {
    const root = tempWorkspace();
    const model = createScriptedModel([say("hi")]);
    const seen: Message[] = [];
    const base = deps(root, model).d;
    await runAgent([], "hello", { ...base, onMessage: (m) => seen.push(m) });
    expect(seen.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  test("stops with an error after maxTurns", async () => {
    const root = tempWorkspace({ "a.txt": "a" });
    const loop = Array.from({ length: 5 }, (_, i) => reply(toolUse("read", { path: "a.txt" }, `t${i}`)));
    const { d } = deps(root, createScriptedModel(loop));
    await expect(runAgent([], "loop", { ...d, maxTurns: 2 })).rejects.toThrow("stopped after 2 turns");
  });

  test("exposes the full workspace tool set with specs the provider can use", () => {
    const names = WORKSPACE_TOOLS.map((t) => t.spec.name).sort();
    expect(names).toEqual(["bash", "edit", "glob", "grep", "read", "write"]);
  });
});

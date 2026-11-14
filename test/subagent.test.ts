import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runAgent } from "../src/agent/loop.ts";
import { checkPairing } from "../src/agent/pairing.ts";
import type { ModelClient, ModelRequest, ModelResponse } from "../src/types.ts";
import { createScriptedModel, reply, say, toolUse } from "../src/model/scripted.ts";
import { buildAgentDeps } from "../src/runtime.ts";
import { collector, roomyBudget, tempWorkspace } from "./helpers.ts";

const firstUserText = (req: ModelRequest): string => {
  const block = req.messages[0]?.content[0];
  return block?.type === "text" ? block.text : "";
};

// A child model that only finishes once BOTH children are in flight. If the
// parent ran task calls one after another, the first child would wait out the
// timeout and maxInFlight would stay at 1.
function barrierChildModel(expected: number) {
  let inFlight = 0;
  let maxInFlight = 0;
  let release!: () => void;
  const both = new Promise<void>((resolve) => (release = resolve));
  const model: ModelClient = {
    async complete(req): Promise<ModelResponse> {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      if (inFlight === expected) release();
      await Promise.race([both, new Promise((r) => setTimeout(r, 1500))]);
      inFlight--;
      return say(`REPORT for ${firstUserText(req)}`);
    },
  };
  return { model, maxInFlight: () => maxInFlight };
}

describe("sub-agents", () => {
  test("two task calls in one turn run in parallel and return only their reports, in order", async () => {
    const root = tempWorkspace();
    const parent = createScriptedModel([
      reply(
        toolUse("task", { description: "alpha", prompt: "ALPHA" }, "t1"),
        toolUse("task", { description: "beta", prompt: "BETA" }, "t2"),
      ),
      say("combined answer"),
    ]);
    const child = barrierChildModel(2);
    const c = collector();
    const deps = buildAgentDeps({
      root,
      model: parent,
      subagentModel: child.model,
      budget: roomyBudget,
      maxTurns: 5,
      ask: async () => true,
      emit: c.emit,
    });

    const result = await runAgent([], "investigate both", deps);

    expect(child.maxInFlight()).toBe(2);
    expect(result.finalText).toBe("combined answer");
    expect(checkPairing(result.messages)).toEqual([]);
    const results = result.messages[2]?.content;
    expect(results).toEqual([
      { type: "tool_result", tool_use_id: "t1", content: "REPORT for ALPHA" },
      { type: "tool_result", tool_use_id: "t2", content: "REPORT for BETA" },
    ]);
    // the parent transcript holds reports, not the child's own messages
    expect(result.messages.length).toBe(4);
    expect(c.events.filter((e) => e.type === "subagent").length).toBe(4);
  });

  test("children get read-only tools and no task tool, so writes are refused", async () => {
    const root = tempWorkspace();
    const parent = createScriptedModel([
      reply(toolUse("task", { description: "tries to write", prompt: "write x.txt" }, "t1")),
      say("parent done"),
    ]);
    const child = createScriptedModel([
      reply(toolUse("write", { path: "x.txt", content: "bad" }, "c1")),
      say("child report: could not write"),
    ]);
    const deps = buildAgentDeps({
      root,
      model: parent,
      subagentModel: child,
      budget: roomyBudget,
      maxTurns: 5,
      ask: async () => true,
      emit: () => undefined,
    });
    const result = await runAgent([], "delegate", deps);
    expect(fs.existsSync(path.join(root, "x.txt"))).toBe(false);
    expect(result.messages[2]?.content[0]).toMatchObject({ tool_use_id: "t1" });
    expect(result.finalText).toBe("parent done");
  });

  test("a child that is asked to delegate again gets an unknown-tool error (no recursion)", async () => {
    const root = tempWorkspace();
    const parent = createScriptedModel([
      reply(toolUse("task", { description: "outer", prompt: "go" }, "t1")),
      say("parent done"),
    ]);
    const child = createScriptedModel([
      reply(toolUse("task", { description: "inner", prompt: "deeper" }, "c1")),
      say("child report"),
    ]);
    const deps = buildAgentDeps({
      root,
      model: parent,
      subagentModel: child,
      budget: roomyBudget,
      maxTurns: 5,
      ask: async () => true,
      emit: () => undefined,
    });
    const result = await runAgent([], "delegate", deps);
    expect(result.finalText).toBe("parent done");
    expect(child.remaining).toBe(0);
  });
});

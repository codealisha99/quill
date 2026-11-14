import { describe, expect, test } from "bun:test";
import { compactMessages, KEEP_RECENT_ASSISTANT_TURNS } from "../src/agent/compact.ts";
import { runAgent } from "../src/agent/loop.ts";
import { checkPairing } from "../src/agent/pairing.ts";
import { createScriptedModel, reply, say, toolUse } from "../src/model/scripted.ts";
import { buildAgentDeps } from "../src/runtime.ts";
import type { Message } from "../src/types.ts";
import { collector, roomyBudget, tempWorkspace } from "./helpers.ts";

const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
const turn = (id: string): Message[] => [
  { role: "assistant", content: [{ type: "tool_use", id, name: "read", input: { path: "a" } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: `result ${id} ${"z".repeat(300)}` }] },
];

function longHistory(turns: number): Message[] {
  const msgs: Message[] = [user("refactor the parser")];
  for (let i = 0; i < turns; i++) msgs.push(...turn(`t${i}`));
  msgs.push({ role: "assistant", content: [{ type: "text", text: "almost there" }] });
  return msgs;
}

// Index of the k-th assistant message counted from the end (1 = last).
function assistantFromEnd(history: readonly Message[], k: number): number {
  const idx = history.flatMap((m, i) => (m.role === "assistant" ? [i] : []));
  return idx[idx.length - k]!;
}

describe("compactMessages", () => {
  test("replaces older turns with a summary, keeps the request, and stays pairing-valid", async () => {
    const history = longHistory(6);
    const model = createScriptedModel([], { summary: "Parser refactor in progress; a.ts read." });
    const result = await compactMessages(history, model);
    expect(result).not.toBeNull();
    const compacted = result!.messages;

    expect(checkPairing(compacted)).toEqual([]);
    expect(compacted.length).toBeLessThan(history.length);
    expect(JSON.stringify(compacted[0])).toContain("Parser refactor in progress");
    expect(JSON.stringify(compacted[0])).toContain("refactor the parser");
    expect(model.summarizerCalls).toHaveLength(1);
    expect(model.summarizerCalls[0]?.tools).toEqual([]);
  });

  test("keeps the last KEEP_RECENT_ASSISTANT_TURNS exchanges byte-for-byte", async () => {
    const history = longHistory(5);
    const result = await compactMessages(history, createScriptedModel([]));
    const cut = assistantFromEnd(history, KEEP_RECENT_ASSISTANT_TURNS);
    expect(result!.messages.slice(1)).toEqual(history.slice(cut));
  });

  test("repeated compaction in one long request does not carry earlier summaries forward", async () => {
    const model = createScriptedModel([], { summary: "S" });
    let messages = (await compactMessages(longHistory(6), model))!.messages;
    const sizes: number[] = [];
    for (let round = 0; round < 4; round++) {
      messages = [...messages, ...turn(`r${round}a`), ...turn(`r${round}b`), ...turn(`r${round}c`)];
      messages = (await compactMessages(messages, model))!.messages;
      expect(checkPairing(messages)).toEqual([]);
      expect(JSON.stringify(messages[0]).split("[Earlier conversation was compacted").length - 1).toBe(1);
      sizes.push(JSON.stringify(messages).length);
    }
    expect(sizes.at(-1)).toBeLessThanOrEqual(sizes[0]!);
    expect(JSON.stringify(messages[0])).toContain("refactor the parser");
  });

  test("returns null when there is nothing old enough to summarise", async () => {
    const short = longHistory(KEEP_RECENT_ASSISTANT_TURNS - 1);
    expect(await compactMessages(short, createScriptedModel([]))).toBeNull();
  });
});

describe("compaction inside the agent loop", () => {
  test("triggers under a tiny budget, persists a snapshot, and every state stays pairing-valid", async () => {
    const root = tempWorkspace({ "big.txt": "line of text\n".repeat(400) });
    const steps = [0, 1, 2, 3].flatMap((i) => [
      reply({ type: "text", text: `working on step ${i}` }, toolUse("read", { path: "big.txt" }, `r${i}`)),
      say(`step ${i} done`),
    ]);
    const model = createScriptedModel(steps, { summary: "Earlier steps read big.txt." });
    const c = collector();
    const snapshots: Message[][] = [];
    const deps = buildAgentDeps(
      {
        root,
        model,
        budget: { ...roomyBudget, contextTokens: 900, maxToolOutputChars: 300 },
        maxTurns: 5,
        ask: async () => true,
        emit: c.emit,
      },
      { onCompact: (ms) => snapshots.push([...ms]) },
    );

    let history: Message[] = [];
    for (let i = 0; i < 4; i++) {
      history = (await runAgent(history, `request ${i}`, deps)).messages;
      expect(checkPairing(history)).toEqual([]);
    }

    const compactions = c.events.filter((e) => e.type === "compaction");
    expect(compactions.length).toBeGreaterThan(0);
    expect(model.summarizerCalls.length).toBe(compactions.length);
    for (const e of compactions) {
      if (e.type === "compaction") expect(e.after).toBeLessThan(e.before);
    }
    expect(snapshots.every((s) => checkPairing(s).length === 0)).toBe(true);
    expect(model.remaining).toBe(0);
  });
});

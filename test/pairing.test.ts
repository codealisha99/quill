import { describe, expect, test } from "bun:test";
import { checkPairing } from "../src/agent/pairing.ts";
import type { Message } from "../src/types.ts";

const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
const asst = (...ids: string[]): Message => ({
  role: "assistant",
  content: ids.map((id) => ({ type: "tool_use" as const, id, name: "read", input: {} })),
});
const results = (...ids: string[]): Message => ({
  role: "user",
  content: ids.map((id) => ({ type: "tool_result" as const, tool_use_id: id, content: "ok" })),
});

describe("checkPairing", () => {
  test("accepts a well-formed transcript", () => {
    expect(checkPairing([user("hi"), asst("a", "b"), results("a", "b"), { role: "assistant", content: [{ type: "text", text: "done" }] }])).toEqual([]);
  });

  test("flags an unanswered tool_use", () => {
    const problems = checkPairing([user("hi"), asst("a"), user("next")]);
    expect(problems.join(" ")).toContain("not answered");
  });

  test("flags a tool_result that answers nothing", () => {
    expect(checkPairing([user("hi"), results("ghost")]).join(" ")).toContain("no matching tool_use");
  });

  test("flags repeated roles and a non-user first message", () => {
    expect(checkPairing([asst()]).join(" ")).toContain("first message");
    expect(checkPairing([user("a"), user("b")]).join(" ")).toContain("repeats role");
  });
});

import { describe, expect, test } from "bun:test";
import { toSdkMessages } from "../src/model/anthropic.ts";
import { createOpenAICompatibleClient, fromOpenAIResponse, toOpenAIMessages } from "../src/model/openai.ts";
import { selectModel, DEFAULT_MODEL } from "../src/model/select.ts";
import type { Message } from "../src/types.ts";

const convo: Message[] = [
  { role: "user", content: [{ type: "text", text: "read a" }] },
  { role: "assistant", content: [{ type: "text", text: "ok" }, { type: "tool_use", id: "c1", name: "read", input: { path: "a" } }] },
  { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "AAA" }] },
];

describe("Anthropic mapping", () => {
  test("maps blocks field-for-field", () => {
    const sdk = toSdkMessages(convo);
    expect(sdk[1]?.content).toEqual([
      { type: "text", text: "ok" },
      { type: "tool_use", id: "c1", name: "read", input: { path: "a" } },
    ]);
    expect(sdk[2]?.content).toEqual([{ type: "tool_result", tool_use_id: "c1", content: "AAA", is_error: false }]);
  });
});

describe("OpenAI-compatible mapping", () => {
  test("turns tool calls into tool_calls and tool results into role=tool messages", () => {
    const oai = toOpenAIMessages("SYS", convo);
    expect(oai[0]).toEqual({ role: "system", content: "SYS" });
    expect(oai[2]?.tool_calls?.[0]).toMatchObject({ id: "c1", function: { name: "read", arguments: '{"path":"a"}' } });
    expect(oai[3]).toEqual({ role: "tool", tool_call_id: "c1", content: "AAA" });
  });

  test("parses a tool-call response into tool_use blocks with usage", () => {
    const res = fromOpenAIResponse({
      choices: [{ message: { content: null, tool_calls: [{ id: "x", type: "function", function: { name: "grep", arguments: '{"pattern":"p"}' } }] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    });
    expect(res.stopReason).toBe("tool_use");
    expect(res.content).toEqual([{ type: "tool_use", id: "x", name: "grep", input: { pattern: "p" } }]);
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 3 });
  });

  test("malformed tool-call arguments are kept as an invalid call, not a thrown error", () => {
    const res = fromOpenAIResponse({
      choices: [{ message: { content: null, tool_calls: [{ id: "x", type: "function", function: { name: "write", arguments: '{"path":"a.txt","content":"unterminated' } }] }, finish_reason: "tool_calls" }],
    });
    const call = res.content[0];
    expect(call).toMatchObject({ type: "tool_use", id: "x", name: "write", invalidInput: { raw: '{"path":"a.txt","content":"unterminated' } });
    expect((call as { invalidInput: { error: string } }).invalidInput.error).toBeTruthy();
  });

  test("client posts to /chat/completions with the bearer key", async () => {
    let seen: { url: string; auth: string | null } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, auth: new Headers(init.headers).get("authorization") };
      return new Response(JSON.stringify({ choices: [{ message: { content: "hi" }, finish_reason: "stop" }] }));
    }) as unknown as typeof fetch;
    const client = createOpenAICompatibleClient({ baseUrl: "http://localhost:11434/v1/", apiKey: "k", model: "m", fetchImpl: fakeFetch });
    const res = await client.complete({ system: "s", messages: convo, tools: [], maxTokens: 10 });
    expect(seen).toEqual({ url: "http://localhost:11434/v1/chat/completions", auth: "Bearer k" });
    expect(res.content).toEqual([{ type: "text", text: "hi" }]);
  });
});

describe("provider selection", () => {
  test("Anthropic is the default when a key is present, with the default model", () => {
    expect(DEFAULT_MODEL).toBe("claude-sonnet-5-5");
    expect(() => selectModel({ ANTHROPIC_API_KEY: "sk-test" })).not.toThrow();
  });

  test("fails with a clear message when nothing is configured", () => {
    expect(() => selectModel({})).toThrow("No model configured");
  });
});

describe("Anthropic response mapping", () => {
  test("keeps text and tool_use, drops thinking blocks", async () => {
    const { fromSdkBlock } = await import("../src/model/anthropic.ts");
    expect(fromSdkBlock({ type: "thinking", thinking: "...", signature: "s" } as never)).toEqual([]);
    expect(fromSdkBlock({ type: "text", text: "hi", citations: null } as never)).toEqual([{ type: "text", text: "hi" }]);
  });
});

// Exercises the real Anthropic SDK streaming path against a local mock server
// that speaks the Messages SSE format. No network and no key are needed.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAnthropicClient } from "../src/model/anthropic.ts";

const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const SCRIPT = [
  sse("message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 12, output_tokens: 1 } } }),
  sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
  sse("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me look. " } }),
  sse("content_block_stop", { type: "content_block_stop", index: 0 }),
  sse("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_9", name: "read", input: {} } }),
  sse("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"path":"a.ts"}' } }),
  sse("content_block_stop", { type: "content_block_stop", index: 1 }),
  sse("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 20 } }),
  sse("message_stop", { type: "message_stop" }),
].join("");

let server: ReturnType<typeof Bun.serve>;
let previousBase: string | undefined;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname !== "/v1/messages") return new Response("not found", { status: 404 });
      return new Response(SCRIPT, { headers: { "content-type": "text/event-stream" } });
    },
  });
  previousBase = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
  if (previousBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
  else process.env.ANTHROPIC_BASE_URL = previousBase;
});

describe("Anthropic streaming adapter (mock server)", () => {
  test("streams text deltas and returns text + tool_use with usage and stop reason", async () => {
    const client = createAnthropicClient({ apiKey: "test-key", model: "claude-sonnet-5-5" });
    const deltas: string[] = [];
    const res = await client.complete(
      {
        system: "sys",
        messages: [{ role: "user", content: [{ type: "text", text: "read a.ts" }] }],
        tools: [{ name: "read", description: "read", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } }],
        maxTokens: 100,
      },
      (d) => deltas.push(d),
    );
    expect(deltas.join("")).toBe("Let me look. ");
    expect(res.content).toEqual([
      { type: "text", text: "Let me look. " },
      { type: "tool_use", id: "toolu_9", name: "read", input: { path: "a.ts" } },
    ]);
    expect(res.stopReason).toBe("tool_use");
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 20 });
  });
});

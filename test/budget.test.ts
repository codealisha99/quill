import { describe, expect, test } from "bun:test";
import { shouldCompact, truncateOutput, estimateTokens, DEFAULT_BUDGET } from "../src/agent/budget.ts";
import type { Message } from "../src/types.ts";

describe("truncateOutput", () => {
  test("leaves short text alone", () => {
    expect(truncateOutput("short", 100)).toBe("short");
  });

  test("keeps head and tail and reports how much was dropped", () => {
    const text = "H".repeat(100) + "M".repeat(800) + "T".repeat(100);
    const out = truncateOutput(text, 200);
    expect(out.startsWith("H".repeat(100))).toBe(true);
    expect(out.endsWith("T".repeat(80))).toBe(true);
    expect(out).toMatch(/\[\d+ chars truncated\]/);
    expect(out.length).toBeLessThan(260);
  });
});

describe("compaction trigger", () => {
  const big: Message[] = [{ role: "user", content: [{ type: "text", text: "x".repeat(4000) }] }];

  test("fires only when estimated usage exceeds the ratio of the budget", () => {
    const tokens = estimateTokens({ system: "", messages: big });
    const tight = { ...DEFAULT_BUDGET, contextTokens: Math.ceil(tokens / 0.8) - 50 };
    const roomy = { ...DEFAULT_BUDGET, contextTokens: tokens * 10 };
    expect(shouldCompact("", big, tight)).toBe(true);
    expect(shouldCompact("", big, roomy)).toBe(false);
  });
});

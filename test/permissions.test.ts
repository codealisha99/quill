import { describe, expect, test } from "bun:test";
import { makeAsker } from "../src/ui/permissions.ts";

describe("permission asker", () => {
  test("auto-approve and deny modes never prompt", async () => {
    let asked = 0;
    const q = async () => (asked++, "n");
    expect(await makeAsker("auto-approve", q)("run ls")).toBe(true);
    expect(await makeAsker("deny", q)("run ls")).toBe(false);
    expect(asked).toBe(0);
  });

  test("prompt mode accepts only y/yes", async () => {
    const answers = ["y", "no", "YES"];
    const ask = makeAsker("prompt", async () => answers.shift() ?? "");
    expect(await ask("a")).toBe(true);
    expect(await ask("b")).toBe(false);
    expect(await ask("c")).toBe(true);
  });

  test("concurrent questions are asked one at a time", async () => {
    let inside = 0;
    let maxInside = 0;
    const question = async () => {
      inside++;
      maxInside = Math.max(maxInside, inside);
      await new Promise((r) => setTimeout(r, 10));
      inside--;
      return "y";
    };
    const ask = makeAsker("prompt", question);
    const results = await Promise.all([ask("one"), ask("two"), ask("three")]);
    expect(results).toEqual([true, true, true]);
    expect(maxInside).toBe(1);
  });
});

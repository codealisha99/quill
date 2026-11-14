import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { main } from "../src/cli.ts";
import { tempWorkspace } from "./helpers.ts";

describe("cli workspace", () => {
  test("a nonexistent -w directory fails with a clear error and creates nothing", async () => {
    const parent = tempWorkspace();
    const missing = path.join(parent, "does-not-exist");
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.join(" ")); };
    try {
      const code = await main(["-w", missing, "-p", "hi"], { ANTHROPIC_API_KEY: "sk-test" });
      expect(code).toBe(2);
    } finally {
      console.error = original;
    }
    expect(errors.join("\n")).toContain("is not a directory");
    expect(fs.existsSync(missing)).toBe(false);
  });
});

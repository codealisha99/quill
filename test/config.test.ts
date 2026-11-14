import { describe, expect, test } from "bun:test";
import { ConfigError, parseConfig, withResumeDefault } from "../src/config.ts";
import { DEFAULT_BUDGET } from "../src/agent/budget.ts";

describe("parseConfig", () => {
  test("defaults", () => {
    const c = parseConfig([], {});
    expect(c.budget.contextTokens).toBe(DEFAULT_BUDGET.contextTokens);
    expect(c.yes).toBe(false);
    expect(c.prompt).toBeUndefined();
  });

  test("flags override env; env sets the budget", () => {
    expect(parseConfig([], { QUILL_CONTEXT_TOKENS: "4000" }).budget.contextTokens).toBe(4000);
    expect(parseConfig(["--context-tokens", "900"], { QUILL_CONTEXT_TOKENS: "4000" }).budget.contextTokens).toBe(900);
  });

  test("-p, --yes and --max-tool-chars", () => {
    const c = parseConfig(["-p", "fix it", "--yes", "--max-tool-chars", "123"], {});
    expect(c.prompt).toBe("fix it");
    expect(c.yes).toBe(true);
    expect(c.budget.maxToolOutputChars).toBe(123);
  });

  test("bare --resume means latest; --resume <file> names a file", () => {
    expect(parseConfig(["--resume"], {}).resume).toBe("latest");
    expect(parseConfig(["--resume", "--yes"], {}).resume).toBe("latest");
    expect(parseConfig(["-r", "/tmp/s.jsonl"], {}).resume).toBe("/tmp/s.jsonl");
    expect(withResumeDefault(["-r"])).toEqual(["-r", "latest"]);
  });

  test("rejects non-positive budgets and unknown flags", () => {
    expect(() => parseConfig(["--context-tokens", "0"], {})).toThrow(ConfigError);
    expect(() => parseConfig(["--context-tokens", "lots"], {})).toThrow("positive integer");
    expect(() => parseConfig(["--bogus"], {})).toThrow();
  });

  test("--help raises the usage text", () => {
    expect(() => parseConfig(["--help"], {})).toThrow("usage: quill");
  });
});

describe("CLI error surface", () => {
  test("unknown flags become a ConfigError, not a raw parser exception", () => {
    expect(() => parseConfig(["--nope"], {})).toThrow(ConfigError);
  });
});

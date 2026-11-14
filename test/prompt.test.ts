import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { buildSystemPrompt, loadProjectInstructions, MAX_INSTRUCTIONS_CHARS } from "../src/agent/prompt.ts";
import { tempWorkspace } from "./helpers.ts";

describe("project instructions", () => {
  test("AGENTS.md is loaded into the system prompt when present", () => {
    const root = tempWorkspace({ "AGENTS.md": "Always run bun test before finishing." });
    const instructions = loadProjectInstructions(root);
    const prompt = buildSystemPrompt(root, instructions);
    expect(prompt).toContain("Project instructions (AGENTS.md):");
    expect(prompt).toContain("Always run bun test before finishing.");
  });

  test("absent AGENTS.md leaves the prompt without an instructions section", () => {
    const root = tempWorkspace();
    expect(loadProjectInstructions(root)).toBeUndefined();
    expect(buildSystemPrompt(root, undefined)).not.toContain("AGENTS.md");
  });

  test("oversized AGENTS.md is capped", () => {
    const root = tempWorkspace();
    fs.writeFileSync(path.join(root, "AGENTS.md"), "x".repeat(MAX_INSTRUCTIONS_CHARS + 500));
    expect(loadProjectInstructions(root)?.length).toBe(MAX_INSTRUCTIONS_CHARS);
  });
});

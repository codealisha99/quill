import fs from "node:fs";
import path from "node:path";

export const MAX_INSTRUCTIONS_CHARS = 20_000;

export function loadProjectInstructions(root: string): string | undefined {
  const file = path.join(root, "AGENTS.md");
  if (!fs.existsSync(file)) return undefined;
  return fs.readFileSync(file, "utf8").slice(0, MAX_INSTRUCTIONS_CHARS);
}

export function buildSystemPrompt(root: string, instructions?: string): string {
  const base = [
    "You are quill, a terminal coding agent working inside one workspace.",
    `Workspace root: ${root}. All file paths are relative to it.`,
    "Read code before changing it. Make minimal, targeted edits. Run the project's tests after changes when they exist.",
    "Use the task tool for self-contained investigations that would flood your context; sub-agents return only a report.",
    "When the work is finished, reply with a short summary of what changed and what you verified.",
  ];
  if (instructions) base.push("", "Project instructions (AGENTS.md):", instructions);
  return base.join("\n");
}

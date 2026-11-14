import fs from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolOutput } from "./tool.ts";
import { optionalNumber, requireString, ToolInputError } from "./tool.ts";
import { resolveInside } from "./paths.ts";

const MAX_READ_BYTES = 2_000_000;
const DEFAULT_READ_LINES = 2000;

export const readTool: Tool = {
  spec: {
    name: "read",
    description: "Read a text file in the workspace. Returns numbered lines. Use offset/limit (1-based line) for big files.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace root." },
        offset: { type: "number", description: "First line to return (1-based)." },
        limit: { type: "number", description: "Maximum number of lines to return." },
      },
      required: ["path"],
    },
  },
  async run(input, ctx): Promise<ToolOutput> {
    const abs = resolveInside(ctx.root, requireString(input, "path"));
    const stat = await fs.stat(abs);
    if (stat.size > MAX_READ_BYTES) throw new ToolInputError(`file is ${stat.size} bytes; limit is ${MAX_READ_BYTES}`);
    const text = await fs.readFile(abs, "utf8");
    if (text.includes("\0")) throw new ToolInputError("refusing to read a binary file");
    const lines = text.split("\n");
    const offset = Math.max(1, optionalNumber(input, "offset") ?? 1);
    const limit = optionalNumber(input, "limit") ?? DEFAULT_READ_LINES;
    const slice = lines.slice(offset - 1, offset - 1 + limit);
    const numbered = slice.map((line, i) => `${offset + i}\t${line}`).join("\n");
    const more = offset - 1 + slice.length < lines.length ? `\n... (${lines.length} lines total)` : "";
    return { content: numbered + more };
  },
};

export const writeTool: Tool = {
  spec: {
    name: "write",
    description: "Create or overwrite a file in the workspace with the given content. Parent directories are created.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
      required: ["path", "content"],
    },
  },
  describePermission: (input) => `write ${String(input.path)}`,
  async run(input, ctx): Promise<ToolOutput> {
    const rel = requireString(input, "path");
    const abs = resolveInside(ctx.root, rel);
    if (typeof input.content !== "string") throw new ToolInputError('"content" must be a string');
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, input.content, "utf8");
    return { content: `wrote ${input.content.length} chars to ${rel}` };
  },
};

export const editTool: Tool = {
  spec: {
    name: "edit",
    description:
      "Replace an exact string in a file. old_string must match exactly once unless replace_all is true. Read the file first.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
  describePermission: (input) => `edit ${String(input.path)}`,
  async run(input, ctx): Promise<ToolOutput> {
    const rel = requireString(input, "path");
    const abs = resolveInside(ctx.root, rel);
    const oldString = requireString(input, "old_string");
    if (typeof input.new_string !== "string") throw new ToolInputError('"new_string" must be a string');
    const newString = input.new_string;
    if (oldString === newString) throw new ToolInputError("old_string and new_string are identical");
    const text = await fs.readFile(abs, "utf8");
    const occurrences = text.split(oldString).length - 1;
    if (occurrences === 0) throw new ToolInputError(`old_string not found in ${rel}`);
    const replaceAll = input.replace_all === true;
    if (occurrences > 1 && !replaceAll) {
      throw new ToolInputError(`old_string occurs ${occurrences} times in ${rel}; add context or set replace_all`);
    }
    const updated = text.split(oldString).join(newString);
    await fs.writeFile(abs, updated, "utf8");
    const count = replaceAll ? occurrences : 1;
    return { content: `edited ${rel} (${count} replacement${count === 1 ? "" : "s"})` };
  },
};

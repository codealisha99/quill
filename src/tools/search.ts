import fs from "node:fs/promises";
import path from "node:path";
import type { Tool, ToolOutput } from "./tool.ts";
import { requireString, ToolInputError } from "./tool.ts";
import { PathEscapeError, resolveInside } from "./paths.ts";

const SKIP_DIRS = new Set([".git", "node_modules", ".quill"]);
const MAX_MATCHES = 200;
const MAX_FILE_BYTES = 1_000_000;
const MAX_GLOB_RESULTS = 500;

export const grepTool: Tool = {
  spec: {
    name: "grep",
    description: "Search file contents with a JavaScript regular expression. Returns path:line: text. Skips .git and node_modules.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string", description: "Directory or file to search. Default: workspace root." },
        glob: { type: "string", description: "Only search files whose relative path matches this glob." },
      },
      required: ["pattern"],
    },
  },
  async run(input, ctx): Promise<ToolOutput> {
    const pattern = compile(requireString(input, "pattern"));
    const base = resolveInside(ctx.root, typeof input.path === "string" ? input.path : ".");
    const globFilter = typeof input.glob === "string" ? new Bun.Glob(input.glob) : undefined;
    const hits: string[] = [];
    for await (const file of walk(base)) {
      const rel = path.relative(base, file) || path.basename(file);
      if (globFilter && !globFilter.match(rel)) continue;
      const text = await readText(file);
      if (text === undefined) continue;
      text.split("\n").forEach((line, i) => {
        if (hits.length < MAX_MATCHES && pattern.test(line)) {
          hits.push(`${path.relative(ctx.root, file)}:${i + 1}: ${line.trim()}`);
        }
      });
      if (hits.length >= MAX_MATCHES) break;
    }
    const note = hits.length >= MAX_MATCHES ? `\n[stopped at ${MAX_MATCHES} matches]` : "";
    return { content: hits.length ? hits.join("\n") + note : "no matches" };
  },
};

export const globTool: Tool = {
  spec: {
    name: "glob",
    description: "List workspace files matching a glob such as **/*.ts. Skips .git and node_modules.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string", description: "Directory to search from. Default: workspace root." },
      },
      required: ["pattern"],
    },
  },
  async run(input, ctx): Promise<ToolOutput> {
    const pattern = requireString(input, "pattern");
    // ponytail: rejecting ".." segments and absolute patterns is the cheap guard; the scan itself never leaves the root
    if (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes("..")) {
      throw new PathEscapeError(`glob pattern leaves the workspace: ${pattern}`);
    }
    const glob = new Bun.Glob(pattern);
    const base = resolveInside(ctx.root, typeof input.path === "string" ? input.path : ".");
    const found: string[] = [];
    for await (const rel of glob.scan({ cwd: base, onlyFiles: true })) {
      if (rel.split(path.sep).some((seg) => SKIP_DIRS.has(seg))) continue;
      found.push(path.relative(ctx.root, path.join(base, rel)));
      if (found.length >= MAX_GLOB_RESULTS) break;
    }
    found.sort();
    return { content: found.length ? found.join("\n") : "no files matched" };
  },
};

function compile(source: string): RegExp {
  try {
    return new RegExp(source);
  } catch (err) {
    throw new ToolInputError(`invalid regular expression: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Symlinks found while walking are never followed, so the walk cannot leave the
// workspace. The starting path may itself be a symlink: resolveInside has already
// checked where it points, so it is followed here.
async function* walk(dir: string): AsyncGenerator<string> {
  const stat = await fs.stat(dir);
  if (!stat.isDirectory()) {
    yield dir;
    return;
  }
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function readText(file: string): Promise<string | undefined> {
  const stat = await fs.stat(file);
  if (stat.size > MAX_FILE_BYTES) return undefined;
  const text = await fs.readFile(file, "utf8");
  return text.includes("\0") ? undefined : text;
}

import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { editTool, readTool, writeTool } from "../src/tools/files.ts";
import { bashTool } from "../src/tools/bash.ts";
import { globTool, grepTool } from "../src/tools/search.ts";
import { ToolInputError } from "../src/tools/tool.ts";
import { PathEscapeError } from "../src/tools/paths.ts";
import { ctxFor, tempWorkspace } from "./helpers.ts";

describe("read", () => {
  test("returns numbered lines and honours offset/limit", async () => {
    const root = tempWorkspace({ "f.txt": "a\nb\nc\nd" });
    const out = await readTool.run({ path: "f.txt", offset: 2, limit: 2 }, ctxFor(root));
    expect(out.content.split("\n")[0]).toBe("2\tb");
    expect(out.content).toContain("3\tc");
    expect(out.content).toContain("4 lines total");
  });

  test("refuses binary files and paths outside the workspace", async () => {
    const root = tempWorkspace({ "bin.dat": "a\0b" });
    await expect(readTool.run({ path: "bin.dat" }, ctxFor(root))).rejects.toThrow(ToolInputError);
    await expect(readTool.run({ path: "../x" }, ctxFor(root))).rejects.toThrow(PathEscapeError);
  });
});

describe("write", () => {
  test("creates parent directories", async () => {
    const root = tempWorkspace();
    await writeTool.run({ path: "a/b/c.txt", content: "hi" }, ctxFor(root));
    expect(fs.readFileSync(path.join(root, "a/b/c.txt"), "utf8")).toBe("hi");
  });

  test("cannot write outside the workspace", async () => {
    const root = tempWorkspace();
    const outside = path.join(root, "..", `escape-${Date.now()}.txt`);
    await expect(writeTool.run({ path: `../${path.basename(outside)}`, content: "x" }, ctxFor(root))).rejects.toThrow(PathEscapeError);
    expect(fs.existsSync(outside)).toBe(false);
  });

  test("declares that it needs permission", () => {
    expect(writeTool.describePermission?.({ path: "a.txt" })).toBe("write a.txt");
  });
});

describe("edit", () => {
  test("replaces a unique exact match", async () => {
    const root = tempWorkspace({ "m.ts": "let i = 1;\nreturn i;" });
    await editTool.run({ path: "m.ts", old_string: "let i = 1;", new_string: "let i = 0;" }, ctxFor(root));
    expect(fs.readFileSync(path.join(root, "m.ts"), "utf8")).toBe("let i = 0;\nreturn i;");
  });

  test("fails when the match is missing or ambiguous", async () => {
    const root = tempWorkspace({ "m.ts": "x x" });
    await expect(editTool.run({ path: "m.ts", old_string: "y", new_string: "z" }, ctxFor(root))).rejects.toThrow("not found");
    await expect(editTool.run({ path: "m.ts", old_string: "x", new_string: "z" }, ctxFor(root))).rejects.toThrow("2 times");
  });

  test("replace_all replaces every occurrence", async () => {
    const root = tempWorkspace({ "m.ts": "x x" });
    const out = await editTool.run({ path: "m.ts", old_string: "x", new_string: "z", replace_all: true }, ctxFor(root));
    expect(out.content).toContain("2 replacements");
    expect(fs.readFileSync(path.join(root, "m.ts"), "utf8")).toBe("z z");
  });

  test("treats replacement text literally ($& is not special)", async () => {
    const root = tempWorkspace({ "m.ts": "a" });
    await editTool.run({ path: "m.ts", old_string: "a", new_string: "$&$1" }, ctxFor(root));
    expect(fs.readFileSync(path.join(root, "m.ts"), "utf8")).toBe("$&$1");
  });
});

describe("bash", () => {
  test("runs in the workspace and reports exit code", async () => {
    const root = tempWorkspace({ "marker.txt": "" });
    const out = await bashTool.run({ command: "ls marker.txt && echo ok" }, ctxFor(root));
    expect(out.content).toContain("marker.txt");
    expect(out.content).toContain("exit code 0");
    expect(out.isError).toBe(false);
  });

  test("captures stderr and non-zero exit as an error", async () => {
    const root = tempWorkspace();
    const out = await bashTool.run({ command: "echo bad >&2; exit 3" }, ctxFor(root));
    expect(out.content).toContain("[stderr]");
    expect(out.content).toContain("exit code 3");
    expect(out.isError).toBe(true);
  });

  test("kills commands that exceed the timeout", async () => {
    const root = tempWorkspace();
    const out = await bashTool.run({ command: "sleep 5", timeout_ms: 100 }, ctxFor(root));
    expect(out.content).toContain("timed out");
    expect(out.isError).toBe(true);
  });

  test("returns at the timeout even when a child keeps the output pipe open", async () => {
    const root = tempWorkspace();
    const started = Date.now();
    const out = await bashTool.run({ command: "sleep 3; echo late", timeout_ms: 200 }, ctxFor(root));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(out.content).toContain("timed out");
    expect(out.isError).toBe(true);
  });
});

describe("glob confinement", () => {
  test("refuses patterns that climb out of the workspace", async () => {
    const root = tempWorkspace({ "a.txt": "x" });
    await expect(globTool.run({ pattern: "../*" }, ctxFor(root))).rejects.toThrow(PathEscapeError);
    await expect(globTool.run({ pattern: "**/../*" }, ctxFor(root))).rejects.toThrow(PathEscapeError);
    await expect(globTool.run({ pattern: "/etc/*" }, ctxFor(root))).rejects.toThrow(PathEscapeError);
  });
});

describe("grep and glob", () => {
  const files = {
    "src/a.ts": "export const needle = 1;\n",
    "src/b.md": "needle in docs\n",
    "node_modules/x/index.ts": "needle\n",
  };

  test("grep finds matches with path:line and skips node_modules", async () => {
    const root = tempWorkspace(files);
    const out = await grepTool.run({ pattern: "needle" }, ctxFor(root));
    expect(out.content).toContain("src/a.ts:1:");
    expect(out.content).toContain("src/b.md:1:");
    expect(out.content).not.toContain("node_modules");
  });

  test("grep honours the glob filter", async () => {
    const root = tempWorkspace(files);
    const out = await grepTool.run({ pattern: "needle", glob: "**/*.ts" }, ctxFor(root));
    expect(out.content).toContain("src/a.ts");
    expect(out.content).not.toContain("src/b.md");
  });

  test("grep rejects invalid regular expressions", async () => {
    await expect(grepTool.run({ pattern: "(" }, ctxFor(tempWorkspace()))).rejects.toThrow(ToolInputError);
  });

  test("glob lists matching files, sorted, without node_modules", async () => {
    const root = tempWorkspace(files);
    const out = await globTool.run({ pattern: "**/*.{ts,md}" }, ctxFor(root));
    expect(out.content.split("\n")).toEqual(["src/a.ts", "src/b.md"]);
  });
});

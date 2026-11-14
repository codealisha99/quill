import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { PathEscapeError, resolveInside } from "../src/tools/paths.ts";
import { tempWorkspace } from "./helpers.ts";

describe("resolveInside (path confinement)", () => {
  test("accepts ordinary relative paths, including not-yet-existing nested files", () => {
    const root = tempWorkspace({ "src/a.ts": "x" });
    expect(resolveInside(root, "src/a.ts")).toBe(path.resolve(root, "src/a.ts"));
    expect(() => resolveInside(root, "new/deep/file.txt")).not.toThrow();
  });

  test("rejects parent-directory escapes", () => {
    const root = tempWorkspace();
    expect(() => resolveInside(root, "../outside.txt")).toThrow(PathEscapeError);
    expect(() => resolveInside(root, "a/../../outside.txt")).toThrow(PathEscapeError);
  });

  test("accepts names that merely start with two dots", () => {
    const root = tempWorkspace({ "..notes/a.txt": "x" });
    expect(() => resolveInside(root, "..notes/a.txt")).not.toThrow();
  });

  test("rejects absolute paths outside the workspace", () => {
    const root = tempWorkspace();
    expect(() => resolveInside(root, "/etc/hosts")).toThrow(PathEscapeError);
  });

  test("rejects NUL bytes", () => {
    expect(() => resolveInside(tempWorkspace(), "a\0b")).toThrow(PathEscapeError);
  });

  test("rejects a symlink that points outside the workspace", () => {
    const root = tempWorkspace();
    const outside = tempWorkspace({ "secret.txt": "s" });
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
    expect(() => resolveInside(root, "link.txt")).toThrow(PathEscapeError);
  });

  test("rejects a dangling symlink that would create a file outside", () => {
    const root = tempWorkspace();
    const outside = tempWorkspace();
    fs.symlinkSync(path.join(outside, "created.txt"), path.join(root, "dangling.txt"));
    expect(() => resolveInside(root, "dangling.txt")).toThrow(PathEscapeError);
  });

  test("accepts a symlink that stays inside the workspace", () => {
    const root = tempWorkspace({ "real.txt": "r" });
    fs.symlinkSync(path.join(root, "real.txt"), path.join(root, "alias.txt"));
    expect(() => resolveInside(root, "alias.txt")).not.toThrow();
  });
});

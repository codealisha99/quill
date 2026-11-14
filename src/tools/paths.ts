import fs from "node:fs";
import path from "node:path";

export class PathEscapeError extends Error {}

// Resolves a model-supplied path and refuses anything that lands outside the
// workspace, including via "..", absolute paths, or symlinks (existing or dangling).
export function resolveInside(root: string, requested: string): string {
  if (requested.includes("\0")) throw new PathEscapeError("path contains a NUL byte");
  const abs = path.resolve(root, requested);
  const realRoot = fs.realpathSync(root);
  const real = realpathOfNearestExisting(abs);
  if (!isWithin(realRoot, real)) {
    throw new PathEscapeError(`path is outside the workspace: ${requested}`);
  }
  return abs;
}

export function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// Walks up to the closest ancestor that exists and resolves its symlinks, then
// re-appends the missing tail. A dangling symlink is treated as an escape,
// because writing through it would create a file at its (unchecked) target.
function realpathOfNearestExisting(abs: string): string {
  const tail: string[] = [];
  let current = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail);
    } catch (err) {
      if (!isNotFound(err)) throw err;
      if (isDanglingSymlink(current)) {
        throw new PathEscapeError(`refusing to follow dangling symlink: ${current}`);
      }
      const parent = path.dirname(current);
      if (parent === current) throw err;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

function isNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

function isDanglingSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

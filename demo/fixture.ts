import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Creates a throwaway workspace in the OS temp dir. Callers delete it when done.
export function makeFixture(prefix: string, files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

// Runs the fixture's own test suite exactly as a developer would.
export async function runTests(root: string): Promise<{ passed: boolean; output: string }> {
  const proc = Bun.spawn(["bun", "test"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  return { passed: code === 0, output: `${stdout}${stderr}`.trim() };
}

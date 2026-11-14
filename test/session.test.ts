import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { appendRecord, latestSessionFile, loadSession, newSessionFile, sessionsDir } from "../src/session/store.ts";
import type { Message } from "../src/types.ts";
import { tempWorkspace } from "./helpers.ts";

const user = (text: string): Message => ({ role: "user", content: [{ type: "text", text }] });
const bot = (text: string): Message => ({ role: "assistant", content: [{ type: "text", text }] });

describe("session persistence", () => {
  test("messages round-trip through JSONL in order", () => {
    const root = tempWorkspace();
    const file = newSessionFile(root);
    appendRecord(file, { kind: "message", message: user("a") });
    appendRecord(file, { kind: "message", message: bot("b") });
    expect(loadSession(file)).toEqual([user("a"), bot("b")]);
  });

  test("a compaction record replaces the replayed history with its snapshot", () => {
    const root = tempWorkspace();
    const file = newSessionFile(root);
    appendRecord(file, { kind: "message", message: user("old") });
    appendRecord(file, { kind: "message", message: bot("old reply") });
    appendRecord(file, { kind: "compaction", messages: [user("summary")] });
    appendRecord(file, { kind: "message", message: bot("new reply") });
    expect(loadSession(file)).toEqual([user("summary"), bot("new reply")]);
  });

  test("latestSessionFile picks the newest session, and none when there are none", () => {
    const root = tempWorkspace();
    expect(latestSessionFile(root)).toBeUndefined();
    const first = newSessionFile(root, new Date("2026-01-01T00:00:00Z"));
    const second = newSessionFile(root, new Date("2026-02-01T00:00:00Z"));
    appendRecord(first, { kind: "message", message: user("1") });
    appendRecord(second, { kind: "message", message: user("2") });
    expect(latestSessionFile(root)).toBe(second);
    expect(fs.readdirSync(sessionsDir(root)).length).toBe(2);
    expect(path.dirname(second)).toBe(sessionsDir(root));
  });

  test("a corrupt record fails loudly instead of silently losing history", () => {
    const root = tempWorkspace();
    const file = newSessionFile(root);
    fs.writeFileSync(file, '{"kind":"nope"}\n');
    expect(() => loadSession(file)).toThrow("unknown record kind");
  });
});

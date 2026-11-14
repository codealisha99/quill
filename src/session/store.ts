import fs from "node:fs";
import path from "node:path";
import type { Message } from "../types.ts";

// Append-only JSONL. A "compaction" record snapshots the compacted history so
// replay never has to re-run the summarizer.
export type SessionRecord =
  | { readonly kind: "message"; readonly message: Message }
  | { readonly kind: "compaction"; readonly messages: readonly Message[] };

export const sessionsDir = (root: string): string => path.join(root, ".quill", "sessions");

export function newSessionFile(root: string, now: Date = new Date()): string {
  const dir = sessionsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const suffix = Math.random().toString(36).slice(2, 8);
  return path.join(dir, `${stamp}-${suffix}.jsonl`);
}

export function appendRecord(file: string, record: SessionRecord): void {
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`, "utf8");
}

export function latestSessionFile(root: string): string | undefined {
  const dir = sessionsDir(root);
  if (!fs.existsSync(dir)) return undefined;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")).sort();
  const last = files.at(-1);
  return last ? path.join(dir, last) : undefined;
}

export function loadSession(file: string): Message[] {
  const lines = readCompleteLines(file);
  return lines.reduce<Message[]>((messages, line, i) => {
    const record = parseRecord(line, i + 1);
    return record.kind === "compaction" ? [...record.messages] : [...messages, record.message];
  }, []);
}

// A crash mid-append can leave a partial last line with no newline. That record never
// finished, so it is dropped and the file truncated. Otherwise the next append would
// glue onto it and corrupt the middle of the file. Works on bytes, so UTF-8 is safe.
function readCompleteLines(file: string): string[] {
  const buf = fs.readFileSync(file);
  const end = buf.lastIndexOf(0x0a) + 1;
  if (end < buf.length) fs.truncateSync(file, end);
  return buf.subarray(0, end).toString("utf8").split("\n").filter((l) => l.trim().length > 0);
}

export function parseRecord(line: string, lineNo: number): SessionRecord {
  const value = JSON.parse(line) as SessionRecord;
  if (value.kind !== "message" && value.kind !== "compaction") {
    throw new Error(`session line ${lineNo}: unknown record kind`);
  }
  return value;
}

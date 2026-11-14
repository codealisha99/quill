import type { Message, ToolUseBlock } from "../types.ts";

const toolUses = (m: Message): ToolUseBlock[] =>
  m.content.filter((b): b is ToolUseBlock => b.type === "tool_use");

// Invariants a provider will reject if broken:
//  - the first message is from the user and roles alternate
//  - every tool_use in an assistant message has exactly one tool_result in the
//    next user message, and every tool_result answers a tool_use just before it
// Returns human-readable violations; an empty array means the transcript is valid.
export function checkPairing(messages: readonly Message[]): string[] {
  const problems: string[] = [];
  if (messages.length === 0) return problems;
  if (messages[0]?.role !== "user") problems.push("first message is not from the user");
  messages.forEach((m, i) => {
    const prev = messages[i - 1];
    if (i > 0 && prev?.role === m.role) problems.push(`message ${i} repeats role ${m.role}`);
    if (m.role === "assistant") {
      const ids = toolUses(m).map((b) => b.id);
      const next = messages[i + 1];
      const results = next?.role === "user"
        ? next.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : []))
        : [];
      if (ids.length > 0 && !sameIds(ids, results)) {
        problems.push(`assistant message ${i} tool_use ids [${ids}] not answered by next message ([${results}])`);
      }
    }
    if (m.role === "user" && i > 0 && m.content.some((b) => b.type === "tool_result")) {
      const answered = m.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : []));
      const offered = prev?.role === "assistant" ? toolUses(prev).map((b) => b.id) : [];
      if (!answered.every((id) => offered.includes(id))) {
        problems.push(`message ${i} has tool_result with no matching tool_use in previous message`);
      }
    }
  });
  return problems;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

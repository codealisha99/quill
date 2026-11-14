// Serialises permission questions so parallel tool calls never interleave prompts.
export type Question = (text: string) => Promise<string>;

export function makeAsker(
  mode: "auto-approve" | "prompt" | "deny",
  question?: Question,
): (text: string) => Promise<boolean> {
  if (mode === "auto-approve") return async () => true;
  if (mode === "deny" || !question) return async () => false;
  let queue: Promise<unknown> = Promise.resolve();
  return (text) => {
    const next = queue.then(async () => {
      const answer = await question(`\n? allow ${text}? [y/N] `);
      return /^y(es)?$/i.test(answer.trim());
    });
    queue = next.catch(() => undefined);
    return next;
  };
}

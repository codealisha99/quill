import type { ModelClient } from "../types.ts";
import { createAnthropicClient } from "./anthropic.ts";
import { createOpenAICompatibleClient } from "./openai.ts";

export const DEFAULT_MODEL = "claude-sonnet-5-5";

export interface ProviderEnv {
  readonly ANTHROPIC_API_KEY?: string;
  readonly QUILL_MODEL?: string;
  readonly QUILL_OPENAI_BASE_URL?: string;
  readonly QUILL_OPENAI_API_KEY?: string;
}

// Anthropic is the default. The OpenAI-compatible path is chosen only when a
// base URL is set and no Anthropic key is present.
export function selectModel(env: ProviderEnv): ModelClient {
  const model = env.QUILL_MODEL || DEFAULT_MODEL;
  if (env.ANTHROPIC_API_KEY) {
    return createAnthropicClient({ apiKey: env.ANTHROPIC_API_KEY, model });
  }
  if (env.QUILL_OPENAI_BASE_URL) {
    return createOpenAICompatibleClient({
      baseUrl: env.QUILL_OPENAI_BASE_URL,
      apiKey: env.QUILL_OPENAI_API_KEY || undefined,
      model: env.QUILL_MODEL || "llama3.1",
    });
  }
  throw new Error(
    "No model configured. Set ANTHROPIC_API_KEY (default), or QUILL_OPENAI_BASE_URL for an OpenAI-compatible server.",
  );
}

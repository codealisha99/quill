// Provider-neutral conversation model. Anything a provider adapter needs is
// translated at the edge (src/model/*); the agent only ever sees these shapes.

export interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

export interface ToolUseBlock {
  readonly type: "tool_use";
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
}

export interface ToolResultBlock {
  readonly type: "tool_result";
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error?: boolean;
}

export type Block = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  readonly role: "user" | "assistant";
  readonly content: readonly Block[];
}

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown; // SDK InputSchema requires an open index signature
}

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly input_schema: JsonSchemaObject;
}

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface ModelRequest {
  readonly system: string;
  readonly messages: readonly Message[];
  readonly tools: readonly ToolSpec[];
  readonly maxTokens: number;
}

export interface ModelResponse {
  readonly content: readonly Block[];
  readonly stopReason: "end_turn" | "tool_use" | "max_tokens";
  readonly usage: Usage;
}

export interface ModelClient {
  complete(
    request: ModelRequest,
    onText?: (delta: string) => void,
  ): Promise<ModelResponse>;
}

import type { ToolSpec } from "../types.ts";

export interface ToolContext {
  readonly root: string;
  readonly ask: (question: string) => Promise<boolean>;
}

export interface ToolOutput {
  readonly content: string;
  readonly isError?: boolean;
}

export interface Tool {
  readonly spec: ToolSpec;
  // Return a question for the user when this call needs approval, else undefined.
  readonly describePermission?: (input: Record<string, unknown>) => string | undefined;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutput>;
}

export class ToolInputError extends Error {}

export function requireString(input: Record<string, unknown>, key: string): string {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolInputError(`"${key}" must be a non-empty string`);
  }
  return value;
}

export function optionalNumber(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ToolInputError(`"${key}" must be a number`);
  }
  return value;
}

export function optionalBoolean(input: Record<string, unknown>, key: string): boolean {
  const value = input[key];
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new ToolInputError(`"${key}" must be a boolean`);
  return value;
}

import type { Tool } from "./tool.ts";
import { bashTool } from "./bash.ts";
import { editTool, readTool, writeTool } from "./files.ts";
import { globTool, grepTool } from "./search.ts";

export { makeTaskTool } from "./task.ts";

// Tools that cannot change anything: the only set sub-agents receive.
export const READ_ONLY_TOOLS: readonly Tool[] = [readTool, grepTool, globTool];

// Everything the main agent may use (task is added by the runtime).
export const WORKSPACE_TOOLS: readonly Tool[] = [...READ_ONLY_TOOLS, writeTool, editTool, bashTool];

import type { Tool } from "./types";
import { AGENT_TOOL_CATALOG } from "../../shared/agent-tool-catalog.js";

const modules = import.meta.glob<{ default: Tool }>("../tools/*/index.ts", { eager: true });
export const tools: Tool[] = Object.values(modules).map((m) => m.default);
export const getTool = (id: string) => tools.find((t) => t.id === id);

/**
 * Only browser-local, explicitly catalogued tools are offered to the future model.
 * AI-dependent tools are excluded so a tool call cannot recursively activate AI.
 */
export const toolDefinitions = () => AGENT_TOOL_CATALOG
  .filter((definition) => {
    const local = getTool(definition.name);
    return !!local && !local.usesAI;
  })
  .map((definition) => ({
    name: definition.name,
    description: definition.description,
    input_schema: definition.input_schema,
  }));

export function validateLocalToolArguments(tool: Tool, input: unknown, workspaceNames: readonly string[]): { files: string[]; options: Record<string, string> } | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  const allowed = new Set(["files", ...(tool.options ?? []).map((option) => option.key)]);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 50) return null;
  const files = value.files;
  if (files.some((name) => typeof name !== "string" || name.length < 1 || name.length > 180 || !workspaceNames.includes(name))) return null;
  if (!tool.multiple && files.length > 1) return null;
  const options: Record<string, string> = {};
  for (const option of tool.options ?? []) {
    const raw = value[option.key] ?? option.default;
    if (typeof raw !== "string" && typeof raw !== "number") return null;
    const normalized = String(raw);
    if (normalized.length > 120) return null;
    if (option.choices && !option.choices.includes(normalized)) return null;
    if (option.key === "quality" && tool.id === "image-convert" && (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(normalized) || Number(normalized) < 0.1 || Number(normalized) > 1)) return null;
    if (option.key === "maxWidth" && (!/^\d{1,5}$/.test(normalized) || Number(normalized) > 10000)) return null;
    if (option.key === "ranges" && !/^(?:each|\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/.test(normalized)) return null;
    options[option.key] = normalized;
  }
  return { files: files as string[], options };
}

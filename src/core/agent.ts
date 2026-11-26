import { api, checkAccess } from "./permissions";
import { validateFiles } from "./file-validation";
import { getPlanLimits } from "./entitlements.js";
import { getTool, toolDefinitions, validateLocalToolArguments } from "./registry";
import { assertAgentEnabled, callAI } from "./ai";
import type { Plan } from "./types";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, any> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type Msg = { role: "user" | "assistant"; content: string | Block[] };

export function uniqueName(name: string, ws: Map<string, File>) {
  if (!ws.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const [base, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  for (let i = 2; ; i++) if (!ws.has(`${base}-${i}${ext}`)) return `${base}-${i}${ext}`;
}

// ابزارها روی دستگاه کاربر اجرا می‌شوند؛ مدل فقط نام فایل‌ها و نتیجه متنی را می‌بیند
async function execute(b: Extract<Block, { type: "tool_use" }>, ws: Map<string, File>, plan: Plan): Promise<Block> {
  const err = (message: string): Block => ({ type: "tool_result", tool_use_id: b.id, content: message, is_error: true });
  const tool = getTool(b.name);
  if (!tool || tool.usesAI) return err("Unknown or unavailable local tool");
  const validated = validateLocalToolArguments(tool, b.input, [...ws.keys()]);
  if (!validated) return err("Invalid tool arguments or files outside the local workspace");
  const files = validated.files.map((name) => ws.get(name));
  if (files.some((file) => !file)) return err("Some file names are not in the workspace");
  const list = files as File[];
  if (checkAccess(tool, plan, list.length)) return err("This needs a Pro subscription (batch or Pro tool). Tell the user to upgrade.");
  if (tool.requiresConfirmation) {
    const approved = typeof window !== "undefined" && window.confirm(`Allow the assistant to run ${tool.name} on ${validated.files.join(", ")}?`);
    if (!approved) return err("The user declined this action. No file was changed.");
  }
  const planLimits = getPlanLimits(plan);
  const maxPages = plan === "pro" ? (tool.maxPdfPagesPro ?? planLimits.files.maxPdfPages) : (tool.maxPdfPages ?? planLimits.files.maxPdfPages);
  try { await validateFiles(list, tool.accepts, tool.multiple, maxPages, plan); }
  catch (error) { return err((error as Error).message); }
  try {
    const result = await tool.run(list, { options: validated.options, callAI });
    const outputs = result.files ?? [];
    const workspaceLimits = planLimits.workspace;
    const workspaceBytes = [...ws.values()].reduce((total, file) => total + file.size, 0);
    const outputBytes = outputs.reduce((total, file) => total + file.size, 0);
    if (outputs.some((file) => file.size > workspaceLimits.maxRecordBytes) || ws.size + outputs.length > workspaceLimits.maxRecords || workspaceBytes + outputBytes > workspaceLimits.maxTotalBytes) return err("output_limit");
    const added = outputs.map((file) => { const name = uniqueName(file.name, ws); ws.set(name, new File([file], name, { type: file.type })); return { name, size: file.size }; });
    return { type: "tool_result", tool_use_id: b.id, content: JSON.stringify({ created: added, text: result.text?.slice(0, 4000) }) };
  } catch (error) {
    return err((error as Error).message);
  }
}

export async function runAgent(history: Msg[], ws: Map<string, File>, plan: Plan, onChange: (h: Msg[]) => void): Promise<Msg[]> {
  await assertAgentEnabled();
  const h = [...history];
  for (let step = 0; step < 6; step++) {
    const files = [...ws].map(([name, f]) => ({ name, type: f.type, size: f.size }));
    const res = await api<{ content: Block[]; stop_reason: string }>("/api/agent", { messages: h, files });
    h.push({ role: "assistant", content: res.content });
    onChange([...h]);
    if (res.stop_reason !== "tool_use") break;
    const uses = res.content.filter((c): c is Extract<Block, { type: "tool_use" }> => c.type === "tool_use");
    const results: Block[] = [];
    for (const u of uses) results.push(await execute(u, ws, plan));
    h.push({ role: "user", content: results });
    onChange([...h]);
  }
  return h;
}

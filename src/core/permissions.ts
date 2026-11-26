import type { Plan, Tool } from "./types";
import { getToolFileLimit } from "./entitlements.js";

const KEY = "session_token";
export const getToken = (): string | null => {
  try { return localStorage.getItem(KEY); }
  catch { return null; }
};
export const setToken = (token: string | null): void => {
  try {
    if (token) localStorage.setItem(KEY, token);
    else localStorage.removeItem(KEY);
  } catch {
    // A login cannot be considered complete unless its session token can be persisted.
    if (token) throw new Error("session_storage_unavailable");
  }
};

export interface Me { email: string; emailVerified: boolean; emailVerificationEnabled: boolean; emailVerificationWarning: boolean; emailVerificationWarningAt: number; passwordReady: boolean; plan: Plan; planUntil: number | null; hasStripe: boolean; usage?: { aiUsed: number; agentUsed: number; assistantUsed?: number; aiLimit: number; agentLimit: number; assistantLimit?: number; translateUsed?: number; translateLimit?: number } }

// همه فراخوانی‌های Worker از اینجا؛ خطاها «کد» هستند و در UI ترجمه می‌شوند
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((data as { error?: string }).error ?? "ai_failed");
  return data as T;
}

export const fetchMe = () => api<Me>("/api/me").catch(() => null);

// این محدودیت برای ابزارهای محلی فقط در رابط کاربری اعمال می‌شود؛ پردازش فایل روی دستگاه است و سرور نمی‌تواند آن را به‌طور قطعی enforce کند. سهمیه‌های AI در Worker کنترل می‌شوند.
export function checkAccess(tool: Tool, plan: Plan, fileCount: number): string | null {
  if (tool.plan === "pro" && plan !== "pro") return "upgrade_tool";
  const batchCap = getToolFileLimit(tool, plan);
  const declaredCap = plan === "pro" ? tool.maxFilesPro : tool.maxFilesFree;
  const cap = tool.multiple ? Math.min(batchCap, declaredCap ?? batchCap) : 1;
  if (fileCount > cap) return plan === "pro" ? "too_many_files" : "upgrade_batch";
  return null;
}

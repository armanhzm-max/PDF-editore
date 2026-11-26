import { getToolFileLimit } from "./entitlements.js";
const KEY = "session_token";
export const getToken = () => {
    try {
        return localStorage.getItem(KEY);
    }
    catch {
        return null;
    }
};
export const setToken = (token) => {
    try {
        if (token)
            localStorage.setItem(KEY, token);
        else
            localStorage.removeItem(KEY);
    }
    catch {
        // A login cannot be considered complete unless its session token can be persisted.
        if (token)
            throw new Error("session_storage_unavailable");
    }
};
// همه فراخوانی‌های Worker از اینجا؛ خطاها «کد» هستند و در UI ترجمه می‌شوند
export async function api(path, body) {
    const r = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken() ?? ""}` },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok)
        throw new Error(data.error ?? "ai_failed");
    return data;
}
export const fetchMe = () => api("/api/me").catch(() => null);
// این محدودیت برای ابزارهای محلی فقط در رابط کاربری اعمال می‌شود؛ پردازش فایل روی دستگاه است و سرور نمی‌تواند آن را به‌طور قطعی enforce کند. سهمیه‌های AI در Worker کنترل می‌شوند.
export function checkAccess(tool, plan, fileCount) {
    if (tool.plan === "pro" && plan !== "pro")
        return "upgrade_tool";
    const batchCap = getToolFileLimit(tool, plan);
    const declaredCap = plan === "pro" ? tool.maxFilesPro : tool.maxFilesFree;
    const cap = tool.multiple ? Math.min(batchCap, declaredCap ?? batchCap) : 1;
    if (fileCount > cap)
        return plan === "pro" ? "too_many_files" : "upgrade_batch";
    return null;
}

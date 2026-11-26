import { api } from "./permissions";
const DISABLED_STATUS = {
    aiEnabled: false,
    chatEnabled: false,
    documentsEnabled: false,
    agentEnabled: false,
    providerConfigured: false,
    reason: "disabled",
    capabilities: [],
};
let cachedStatus = DISABLED_STATUS;
let cachedAt = 0;
let inFlight = null;
/** Fetches public, non-sensitive feature flags from our own Worker only. */
export async function getAIFeatureStatus(force = false) {
    if (!force && Date.now() - cachedAt < 15_000)
        return cachedStatus;
    if (!force && inFlight)
        return inFlight;
    inFlight = (async () => {
        try {
            const response = await fetch("/api/features", { method: "GET", cache: "no-store", headers: { Accept: "application/json" } });
            if (!response.ok)
                throw new Error("feature_status_unavailable");
            const payload = await response.json();
            const status = {
                aiEnabled: payload.aiEnabled === true,
                chatEnabled: payload.chatEnabled === true,
                documentsEnabled: payload.documentsEnabled === true,
                agentEnabled: payload.agentEnabled === true,
                providerConfigured: payload.providerConfigured === true,
                reason: payload.reason === "ready" || payload.reason === "not_configured" ? payload.reason : "disabled",
                capabilities: Array.isArray(payload.capabilities) ? payload.capabilities.filter((item) => typeof item === "string").slice(0, 20) : [],
            };
            cachedStatus = status;
            cachedAt = Date.now();
            return status;
        }
        catch {
            const unavailable = { ...DISABLED_STATUS, reason: "unavailable" };
            cachedStatus = unavailable;
            cachedAt = Date.now();
            return unavailable;
        }
        finally {
            inFlight = null;
        }
    })();
    return inFlight;
}
export function clearAIFeatureStatusCache() {
    cachedAt = 0;
    cachedStatus = DISABLED_STATUS;
    inFlight = null;
}
export async function callAI(prompt, text, messages) {
    const status = await getAIFeatureStatus(true);
    if (!status.documentsEnabled)
        throw new Error(status.reason === "unavailable" ? "ai_status_unavailable" : "ai_disabled");
    return api("/api/ai", { prompt, text, ...(messages ? { messages } : {}) }).then((result) => result.result);
}
export async function callAssistant(messages, documentContext) {
    const status = await getAIFeatureStatus(true);
    if (!status.chatEnabled)
        throw new Error(status.reason === "unavailable" ? "ai_status_unavailable" : "ai_disabled");
    return api("/api/assistant", { messages, documentContext }).then((result) => result.result);
}
export async function assertAgentEnabled() {
    const status = await getAIFeatureStatus(true);
    if (!status.agentEnabled)
        throw new Error(status.reason === "unavailable" ? "ai_status_unavailable" : "agent_disabled");
}

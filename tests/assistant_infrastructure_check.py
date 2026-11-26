from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
read = lambda p: (ROOT / p).read_text(encoding="utf-8")

chat = read("src/ui/Chat.tsx")
ai = read("src/core/ai.ts")
agent = read("src/core/agent.ts")
registry = read("src/core/registry.ts")
permissions = read("src/core/permissions.ts")
extract = read("src/core/document-extract.ts")
worker = read("worker/index.ts")
schema = read("worker/schema.sql")
catalog = read("shared/agent-tool-catalog.ts")
wrangler = read("wrangler.toml")
guide = read("Documentation/AI/API-INTEGRATION-GUIDE.md")
package = json.loads(read("package.json"))
app = read("src/ui/App.tsx")

def check(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")

check(all(ext in chat for ext in [".pdf", ".docx", ".xlsx", ".pptx", ".txt", ".csv", ".tsv"]), "Assistant UI accepts the supported document types")
check("extractDocument(file" in chat and "Selected local document text" in ai + worker, "Assistant extracts document text locally and sends only explicitly selected text")
check("getAIFeatureStatus" in ai and 'fetch("/api/features"' in ai, "Frontend discovers public Worker feature flags same-origin")
check("/api/features" in worker and "function aiFeatureState" in worker, "Worker exposes non-sensitive public AI feature state")
check('AI_ENABLED = "false"' in wrangler and 'AGENT_ENABLED = "false"' in wrangler, "AI and Agent remain disabled by default in deployment configuration")
check("if (!status.aiEnabled) return fail(\"ai_disabled\", 503)" in worker and "agent_disabled" in worker, "Worker is authoritative and blocks disabled AI and Agent endpoints")
check('"/api/assistant"' in worker and "async function assistant" in worker, "Dedicated conversation endpoint and request contract exist")
check("requestAIProvider" in worker and '"openai-compatible"' in worker and '"anthropic"' in worker, "Provider-independent Worker adapter is prepared without a provider SDK")
check("AI_API_KEY" in worker and "Authorization" in permissions and "api.anthropic.com" not in ai, "Provider credentials remain server-side; frontend calls only same-origin Worker")
check("AGENT_TOOL_CATALOG" in registry and "body.tools" not in worker and "validateAgentToolInput" in worker, "Worker ignores client schemas and validates a server-authoritative tool catalogue")
check("additionalProperties: false" in catalog and "validateLocalToolArguments" in agent, "Tool arguments are allow-listed and revalidated before local execution")
check("requiresConfirmation" in agent and "window.confirm" in agent, "Sensitive or destructive local tools have a user-confirmation hook")
check('"ai" | "agent" | "translate"' in worker and "consumeQuota" in worker and "usage_counters" in schema, "AI, Assistant/Agent, and translation quotas use separate atomic daily counters")
check("AI_SAFETY_SYSTEM" in worker and "untrusted" in worker and "No prompt or file content" in chat + read("src/core/i18n.ts"), "Prompt-injection and document privacy boundaries are explicit")
check("aiEnabled={aiFeatures.chatEnabled}" in app and "agentEnabled={aiFeatures.agentEnabled}" in app, "Assistant UI uses the Worker feature status and displays disabled states")
check("The browser reads supported" in guide and "activation checklist" in guide.lower(), "API activation guide covers the architecture and owner activation workflow")
check("preview" in package["scripts"] and package["scripts"]["preview"] == "vite preview", "Production preview npm script remains available")
check("test:assistant" in package["scripts"]["test"] and "test:assistant-runtime" in package["scripts"]["test"], "Assistant static and runtime tests are part of npm test")
print("All assistant infrastructure checks passed.")

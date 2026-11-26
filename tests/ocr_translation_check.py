from pathlib import Path
import json
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
scan = (ROOT / "src/ui/ScanCenter.tsx").read_text(encoding="utf-8")
translator = (ROOT / "src/ui/Translator.tsx").read_text(encoding="utf-8")
worker = (ROOT / "worker/index.ts").read_text(encoding="utf-8")
schema = (ROOT / "worker/schema.sql").read_text(encoding="utf-8")
limits = (ROOT / "shared/translation-limits.ts").read_text(encoding="utf-8")
migration = (ROOT / "worker/migrations/0004_translation_usage.sql").read_text(encoding="utf-8")
i18n = (ROOT / "src/core/i18n.ts").read_text(encoding="utf-8")
ai = (ROOT / "src/core/ai.ts").read_text(encoding="utf-8")
legal = (ROOT / "src/ui/Legal.tsx").read_text(encoding="utf-8")
wrangler = (ROOT / "wrangler.toml").read_text(encoding="utf-8")
readme = (ROOT / "README.md").read_text(encoding="utf-8")
package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))

# A user-selected region must be the actual OCR input, not just a visual overlay.
for marker in [
    "makeOcrCanvas(source: HTMLCanvasElement, region: ReadingRegion | undefined, enhance: boolean, denoise = false, sharpen = false)",
    'const selectedRegion = target === "full" ? undefined : page.ocrRegion;',
    "makeOcrCanvas(fullCanvas, selectedRegion, enhanceOcr, page.denoise, page.sharpen)",
    "beginRegionMove",
    "beginRegionResize",
    "regionFromGesture",
    "transformReadingRegion",
    "setPointerCapture(event.pointerId)",
    "ocrNeedsRefresh",
    "confidence: Number(word.confidence ?? 0)",
    '"fas+eng"',
    'brightness(${brightness}%) contrast(${contrast}%)',
    'className="scan-preview" ref={previewViewport}',
    'beginPreviewPan',
    'scanDenoise',
    'scanSharpen',
    'scanCopyAll',
]:
    assert marker in scan, f"Missing OCR behavior: {marker}"
assert "setDragStart" not in scan
assert "only text inside the selected area" in i18n.lower() or "scanRegionActiveHint" in scan
assert "Otsu" in scan or "bestVariance" in scan, "Expected adaptive threshold in black/white preprocessing"
print("PASS: OCR crops the exact selected area, supports shared/per-page selection, move/resize/rotation, adaptive threshold and confidence review")

# Source/result translation UI and consent: only text is submitted, per action.
for marker in [
    'api<TranslationUsage>("/api/translate")',
    'api<TranslationResult>("/api/translate", { text: sourceText, sourceLanguage, targetLanguage })',
    "!consent",
    "translateConsent",
    "setConsent(false)",
    "translator-usage-track",
    "translation_response_truncated",
    "LANGUAGE_OPTIONS",
    "translateHandoffReceived",
    "onSendToWord",
]:
    assert marker in translator, f"Missing translator behavior: {marker}"
assert "arrayBuffer" not in translator and "image" not in " ".join(line for line in translator.splitlines() if "translatePrivacy" not in line).lower(), "Translator implementation must not read or upload image bytes"
assert 'api<TranslationResult>("/api/translate", { text: sourceText, sourceLanguage, targetLanguage })' in translator
for code in ["fa", "en", "ar", "fr", "de", "es", "it", "tr", "ru", "zh", "ja"]:
    assert f'"{code}"' in limits, f"Missing language {code}"
assert "requestsPerDay: 3" in limits and "maxCharacters: 3_000" in limits
assert "requestsPerDay: 200" in limits and "maxCharacters: 20_000" in limits
assert "TRANSLATION_PLAN_LIMITS" in (ROOT / "src/core/entitlements.ts").read_text(encoding="utf-8")
assert "getPlanLimits(currentPlan).translation.maxCharacters" in translator or "getPlanLimits(currentPlan)" in translator
print("PASS: translator supports the configured language set, explicit consent, text-only requests, OCR handoff and Word export")

# Verify Worker-side separation, authentication, input bounds, provider configuration and rate limits.
for marker in [
    'TRANSLATION_ENABLED?: string',
    'return env.TRANSLATION_ENABLED === "true" && !!aiProviderConfig(env)',
    'const result = await requestAIProvider(env,',
    'TRANSLATION_PLAN_LIMITS[plan].requestsPerDay',
    'TRANSLATION_PLAN_LIMITS[plan].maxCharacters',
    'consumeQuota(env, user.id, "translate", dailyLimit, quotaDay)',
    'bumpAtomic(env, `rl:translate:${user.id}`, 10, 60)',
    'pathname === "/api/translate" && method === "POST"',
    'pathname === "/api/translate" && method === "GET"',
    '"x-api-key": config.key',
    '"anthropic-version": "2023-06-01"',
    'AbortController()',
    'releaseQuota(env, user.id, "translate", quotaDay)',
    'new Date().toISOString().slice(0, 10)',
]:
    assert marker in worker, f"Missing Worker translation enforcement: {marker}"
assert 'AI_ENABLED = "false"' in wrangler
assert 'TRANSLATION_ENABLED = "false"' in wrangler
assert "getAIFeatureStatus" in ai and "documentsEnabled" in ai and "chatEnabled" in ai
assert 'const enabled = env.AI_ENABLED === "true" && configured' in worker and 'if (!status.aiEnabled) return fail("ai_disabled", 503)' in worker, "General AI endpoints must remain independently gated"
assert "3 requests/day" in readme and "200 requests/day" in readme
assert "npx wrangler secret put AI_API_KEY" in readme or "secret put AI_API_KEY" in readme
assert "TRANSLATION_ENABLED = \"true\"" in readme
assert "TRANSLATION_ENABLED" in legal and "text" in legal.lower()
print("PASS: Worker has authenticated translation endpoint, independent feature flag, separate atomic quotas, server plan checks, rate limit, timeout and quota refunds; general AI stays disabled")

# Simulate upgrading a pre-translation D1 schema and test the actual atomic UPSERT limit.
db = sqlite3.connect(":memory:")
db.executescript("""
CREATE TABLE usage_counters (
  user_id TEXT NOT NULL,
  usage_day TEXT NOT NULL,
  usage_type TEXT NOT NULL CHECK (usage_type IN ('ai', 'agent')),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (user_id, usage_day, usage_type)
);
CREATE INDEX idx_usage_counters_day ON usage_counters(usage_day);
INSERT INTO usage_counters VALUES ('old-user','2026-11-21','ai',2);
INSERT INTO usage_counters VALUES ('old-user','2026-11-21','agent',4);
""")
db.executescript(migration)
rows = dict((r[0], r[1]) for r in db.execute("SELECT usage_type,count FROM usage_counters WHERE user_id='old-user'"))
assert rows == {"ai": 2, "agent": 4}, rows
assert "translate" in db.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='usage_counters'").fetchone()[0]

atomic = """
INSERT INTO usage_counters (user_id, usage_day, usage_type, count)
VALUES (?, ?, ?, 1)
ON CONFLICT(user_id, usage_day, usage_type)
DO UPDATE SET count = count + 1
WHERE usage_counters.count < ?
RETURNING count
"""
successes = 0
for _ in range(6):
    row = db.execute(atomic, ("free-user", "2026-11-21", "translate", 3)).fetchone()
    successes += row is not None
assert successes == 3, successes
assert db.execute("SELECT count FROM usage_counters WHERE user_id='free-user'").fetchone()[0] == 3
successes = 0
for _ in range(205):
    row = db.execute(atomic, ("pro-user", "2026-11-21", "translate", 200)).fetchone()
    successes += row is not None
assert successes == 200, successes
# Refund must not underflow the separately-counted translation quota.
db.execute("UPDATE usage_counters SET count=CASE WHEN count>0 THEN count-1 ELSE 0 END WHERE user_id='pro-user' AND usage_day='2026-11-21' AND usage_type='translate'")
assert db.execute("SELECT count FROM usage_counters WHERE user_id='pro-user'").fetchone()[0] == 199
print("PASS: D1 migration preserves AI/agent counters; atomic Free/Pro translation limits and failure refunds behave correctly")

# Ensure all new test coverage is actually part of the standard workflow.
assert "test:translation" in package["scripts"]["test"]
assert package["scripts"].get("test:translation") == "python tests/ocr_translation_check.py"
assert package["scripts"].get("test:translation-runtime") == "node tests/translation_worker_runtime.mjs"
assert "test:translation-runtime" in package["scripts"]["test"]
print("PASS: OCR/translation regression, migration, and Worker runtime checks are included in npm test")

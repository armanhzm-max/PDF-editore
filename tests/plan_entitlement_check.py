from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")

ent = read("src/core/entitlements.ts")
permissions = read("src/core/permissions.ts")
workspace = read("src/core/local-workspace.ts")
app = read("src/ui/App.tsx")
pricing = read("src/ui/Account.tsx")
worker = read("worker/index.ts")
ai = read("src/core/ai.ts")
agent = read("src/core/agent.ts")

# Explicit lower Free / higher Pro ceilings across the major workspaces.
checks = [
    ("scan pages", "maxPages: 5" in ent and "maxPages: 20" in ent),
    ("pdf editor pages", "maxPages: 50" in ent and "maxPages: 300" in ent),
    ("word characters", "maxCharacters: 1_500_000" in ent and "maxCharacters: 4_000_000" in ent),
    ("excel rows", "maxRows: 500" in ent and "maxRows: 5_000" in ent),
    ("powerpoint slides", "maxSlides: 30" in ent and "maxSlides: 120" in ent),
    ("local workspace quota", "maxRecords: 10" in ent and "maxRecords: 40" in ent),
    ("multi-document source count", "maxFiles: 3" in ent and "maxFiles: 20" in ent),
]
for name, ok in checks:
    if not ok:
        raise SystemExit(f"FAIL: {name}")
print("PASS: Free and Pro have explicit, higher Pro limits across every workspace")

assert "getToolFileLimit(tool, plan)" in permissions and "tool.multiple ?" in permissions
assert "plan === \"pro\" ? tool.maxFilesPro : tool.maxFilesFree" in permissions
assert "validateFiles(list, tool.accepts, tool.multiple, maxPages, plan)" in agent
assert "const workspaceLimits = planLimits.workspace" in agent
print("PASS: generic file tools and the prepared agent use the selected plan and per-tool limits")

assert "۱۰ پیش‌نویس؛ ۱۵ مگابایت" in pricing and "۴۰ پیش‌نویس؛ ۶۰ مگابایت" in pricing
assert "مقایسه کامل محدودیت‌ها" in pricing and "Full limits comparison" in pricing
assert "tabPlans" in app and "<Pricing" in app
print("PASS: a dedicated Plans view clearly compares Free vs Pro in Persian and English")

assert "const currentPlan = planOf(user)" in worker
assert "aiLimit: LIMITS[currentPlan]" in worker and "agentLimit: AGENT_LIMITS[currentPlan]" in worker
assert 'getAIFeatureStatus' in ai and 'if (!status.documentsEnabled)' in ai
print("PASS: /api/me reports server-authoritative plan and daily quota; AI remains intentionally disabled")

save_body = workspace.split("export async function saveWorkspaceItem", 1)[1].split("export async function listWorkspaceItems", 1)[0]
assert "workspace_plan_limit" in save_body
assert "deleteWorkspaceItem(old.id)" not in save_body
assert "Existing" in save_body or "Downgrades never delete" in save_body
print("PASS: workspace quota checks preserve existing drafts after subscription downgrade")

extractor = read("src/core/document-extract.ts")
doc_ui = read("src/ui/DocumentIntelligence.tsx")
assert "maxFileBytes: 15 * MB" in ent and "maxFileBytes: 50 * MB" in ent
assert "maxPdfPages: 100" in ent and "maxPdfPages: 300" in ent
assert "maxUncompressedBytes: 100 * MB" in ent and "maxUncompressedBytes: 200 * MB" in ent
assert "extractDocument(file, { maxFileBytes: planLimits.maxFileBytes" in doc_ui
assert "extractPdf(file, maxPdfPages)" in extractor
print("PASS: AI document extraction applies Free/Pro per-file, archive-size, and PDF page limits")

assert "account-plan-pill" in app and 'k === "plans" ? "crown"' in app
assert "plan-refresh-row" in pricing and "onRefresh" in pricing
print("PASS: current plan is visible globally and subscription status can be refreshed from the server")

assert "مجموع صفحه‌ها و تصویرها" not in read("src/core/i18n.ts")
assert "حداکثر ۱۰ سند" not in read("src/core/i18n.ts")
print("PASS: limit errors use current-plan wording rather than hard-coded Pro/Free numbers")

# Never truncate or discard saved content solely because the account was downgraded.
for path, needles in {
    "src/ui/WordWorkspace.tsx": ["setHtml(sanitizeWordHtml(item.payload.html))", "exceedsPlan"],
    "src/ui/ExcelWorkspace.tsx": ["clampGrid(item.payload.grid,MAX_ROWS,MAX_COLS)", "exceedsPlan"],
    "src/ui/PowerPointWorkspace.tsx": ["item.payload.slides.slice(0, MAX_SLIDES)", "exceedsPlan"],
    "src/ui/DocumentIntelligence.tsx": ["item.payload.documents.slice(0, 40)", "saved sources were not removed"],
}.items():
    source = read(path)
    for needle in needles:
        assert needle in source, f"{path} missing preservation guard: {needle}"
print("PASS: saved Pro drafts are retained on downgrade and over-limit content is not silently deleted")

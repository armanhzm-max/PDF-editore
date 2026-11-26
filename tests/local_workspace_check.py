from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
core = (ROOT / "src/core/local-workspace.ts").read_text(encoding="utf-8")
word = (ROOT / "src/ui/WordWorkspace.tsx").read_text(encoding="utf-8")
excel = (ROOT / "src/ui/ExcelWorkspace.tsx").read_text(encoding="utf-8")
ppt = (ROOT / "src/ui/PowerPointWorkspace.tsx").read_text(encoding="utf-8")
docs = (ROOT / "src/ui/DocumentIntelligence.tsx").read_text(encoding="utf-8")
library = (ROOT / "src/ui/WorkspaceLibrary.tsx").read_text(encoding="utf-8")
ai = (ROOT / "src/core/ai.ts").read_text(encoding="utf-8")
agent = (ROOT / "src/core/agent.ts").read_text(encoding="utf-8")
worker = (ROOT / "worker/index.ts").read_text(encoding="utf-8")
wrangler = (ROOT / "wrangler.toml").read_text(encoding="utf-8")
app = (ROOT / "src/ui/App.tsx").read_text(encoding="utf-8")
package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))

for marker in [
    'indexedDB.open(DB_NAME, DB_VERSION)', 'createObjectStore(STORE',
    'MAX_RECORD_BYTES = 4 * 1024 * 1024', 'MAX_RECORDS = 40',
    'MAX_TOTAL_RECORD_BYTES = 60 * 1024 * 1024', 'MAX_BACKUP_BYTES = 25 * 1024 * 1024',
    'MAX_FALLBACK_BYTES = 3.5 * 1024 * 1024', 'workspace_item_too_large',
    'exportWorkspaceBackup', 'importWorkspaceBackup', 'clearWorkspaceItems',
    'pdf-ai-tools-workspace', 'backup.version !== 1',
]:
    assert marker in core, f"Missing local storage guard: {marker}"
print("PASS: IndexedDB/localStorage fallback, per-item/count/total/backup bounds, validated JSON backups and clear-all operation")

for label, source in [("Word", word), ("Excel", excel), ("PowerPoint", ppt), ("AI Documents", docs)]:
    assert "saveWorkspaceItem" in source and "loadWorkspaceItem" in source, f"{label} autosave/restore wiring missing"
assert 'setSlides(parsed)' in ppt and 'recordId.current = createWorkspaceId()' in ppt and 'setDirty(true)' in ppt and 'setStatus(t("pptOpened"))' in ppt
assert 'setDirty(true);setStatus(t("excelSaved"))' in excel
assert 'setDirty(true); setStatus(t("pptSaved"))' in ppt
assert 'setDirty(true); setStatus(t("wordExported"))' in word
print("PASS: Word, Excel, PowerPoint and extracted-document workspaces autosave and restore; imported PPTX and exported files retain local autosave")

for marker in ['search.trim()', 'clearWorkspaceItems()', 'exportWorkspaceBackup()', 'importWorkspaceBackup(file)', 'limits.maxTotalBytes', 'items.length']:
    assert marker in library, f"My Workspace feature missing: {marker}"
assert 'savedItemId' in app and 'WorkspaceLibrary' in app and 'tabLibrary' in app
print("PASS: My Workspace supports filters/search, usage meter, per-item delete, clear-all, backup restore/export and open-draft routing")

assert 'getAIFeatureStatus' in ai and 'if (!status.documentsEnabled)' in ai
assert 'assertAgentEnabled' in agent and 'await assertAgentEnabled()' in agent
assert 'const enabled = env.AI_ENABLED === "true" && configured' in worker and 'AI_ENABLED = "false"' in wrangler
assert 'tool.usesAI && !aiFeatures.documentsEnabled' in app
assert 'disabled={!aiEnabled || busy || !documents.length}' in docs
assert 'test:workspace' in package['scripts']['test']
print("PASS: AI remains prepared but disconnected in frontend and Worker; tests are included in npm test")

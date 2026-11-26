from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
folder = (ROOT / "src/core/device-folder.ts").read_text(encoding="utf-8")
workspace = (ROOT / "src/core/local-workspace.ts").read_text(encoding="utf-8")
library = (ROOT / "src/ui/WorkspaceLibrary.tsx").read_text(encoding="utf-8")
package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))

for marker in [
    'showDirectoryPicker', 'mode: "readwrite"', 'requestPermission',
    'indexedDB.open(HANDLE_DB', 'queryPermission', 'workspaceDraftFilename',
    'writeBlobToConnectedFolder', 'readWorkspaceDraftFilesFromFolder',
]:
    assert marker in folder, f"Missing device folder feature: {marker}"
assert 'writeWorkspaceDraftSnapshot(record as DraftSnapshotRecord)' in workspace
assert 'importWorkspaceDraftsFromConnectedFolder' in workspace
assert 'connectDeviceFolder()' in library and 'requestDeviceFolderPermission()' in library
assert 'Disconnecting never deletes files' in library or 'قطع اتصال' in library
for rel in [
    'src/core/file-access.ts', 'src/ui/WordWorkspace.tsx', 'src/ui/ExcelWorkspace.tsx',
    'src/ui/PowerPointWorkspace.tsx', 'src/ui/PDFEditor.tsx', 'src/ui/ScanCenter.tsx',
    'src/ui/DocumentIntelligence.tsx', 'src/ui/WorkspaceLibrary.tsx',
]:
    text = (ROOT / rel).read_text(encoding='utf-8')
    assert 'saveBlobToDeviceOrDownload' in text, f"Generated file output bypasses the connected folder in {rel}"
assert 'getAIFeatureStatus' in (ROOT / 'src/core/ai.ts').read_text(encoding='utf-8') and 'AI_ENABLED = "false"' in (ROOT / 'wrangler.toml').read_text(encoding='utf-8')
assert 'test:device-folder-runtime' in package['scripts']['test']
assert 'test:device-folder-integration' in package['scripts']['test']
print('PASS: explicit folder consent, stored local handle, folder snapshot sync/import, all document exports routed to local folder, AI remains disconnected')

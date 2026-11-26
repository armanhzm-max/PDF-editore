from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
folder = (ROOT / "src/core/device-folder.ts").read_text(encoding="utf-8")
workspace = (ROOT / "src/core/local-workspace.ts").read_text(encoding="utf-8")
app = (ROOT / "src/ui/App.tsx").read_text(encoding="utf-8")
about = (ROOT / "src/ui/About.tsx").read_text(encoding="utf-8")
legal = (ROOT / "src/ui/Legal.tsx").read_text(encoding="utf-8")
feedback = (ROOT / "src/ui/Feedback.tsx").read_text(encoding="utf-8")
ai = (ROOT / "src/core/ai.ts").read_text(encoding="utf-8")
worker = (ROOT / "worker/index.ts").read_text(encoding="utf-8")

assert "showDirectoryPicker" in folder and "mode: \"readwrite\"" in folder
assert "storeHandle(handle)" in folder and "pdf-ai-tools-device-folder" in folder
assert "writeWorkspaceDraftSnapshot" in workspace and "readWorkspaceDraftFilesFromFolder" in workspace
assert "getDeviceFolderStatus" in app and "Choose folder" in app and "انتخاب پوشه" in app
assert "not uploaded" in about.lower() or "به سرور" in about
assert "AI model access is disabled" in legal or "اتصال مدل هوش مصنوعی در این نسخه غیرفعال است" in legal
assert "saveBlobToDeviceOrDownload" in feedback
assert "getAIFeatureStatus" in ai and 'AI_ENABLED = "false"' in (ROOT / "wrangler.toml").read_text(encoding="utf-8")
assert 'AI_ENABLED?: string' in worker and 'env.AI_ENABLED === "true"' in worker
# There must be no document-content API fetch in the device-folder module.
assert "fetch(" not in folder and "/api/" not in folder
print("PASS: explicit folder consent, local handle storage, document snapshots, no server document upload, AI remains disabled, and feedback export uses selected-folder storage")

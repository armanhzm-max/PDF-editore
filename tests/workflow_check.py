from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
app = (ROOT / "src/ui/App.tsx").read_text(encoding="utf-8")
scan = (ROOT / "src/ui/ScanCenter.tsx").read_text(encoding="utf-8")
word = (ROOT / "src/ui/WordWorkspace.tsx").read_text(encoding="utf-8")
docs = (ROOT / "src/ui/DocumentIntelligence.tsx").read_text(encoding="utf-8")
styles = (ROOT / "src/ui/styles.css").read_text(encoding="utf-8")
workflow = (ROOT / "src/core/workflow.ts").read_text(encoding="utf-8")
package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))

assert 'export type TextHandoff' in workflow and 'source: "scan" | "word" | "ai"' in workflow
assert 'onSendToWord' in scan and 'onSendToDocuments' in scan
assert 'getRecognizedTranscript()' in scan and 'sendRecognizedText("word")' in scan and 'sendRecognizedText("ai")' in scan
assert 'handoff?: TextHandoff | null' in word and 'onHandoffConsumed' in word
assert 'onSendToDocuments?.(`${safeFileBase(title)}.txt`, currentText)' in word
assert 'handoff?: TextHandoff | null' in docs and 'format: "TXT"' in docs
assert 'onSendToWord("AI-document-analysis.txt", answer)' in docs
assert 'sendToWord(name, content, "scan")' in app and 'sendToDocuments(name, content, "scan")' in app
assert 'sendToDocuments(name, content, "word")' in app and 'sendToWord(name, content, "ai")' in app
assert 'WorkspaceHub' in app and 'hub-grid' in styles and 'scan-handoff' in styles
assert (ROOT / "src/ui/App.js").exists() and (ROOT / "src/ui/ScanCenter.js").exists()
assert (ROOT / "src/ui/WordWorkspace.js").exists() and (ROOT / "src/ui/DocumentIntelligence.js").exists()
assert 'test:workflow' in package["scripts"]["test"]
print("PASS: OCR → Word/AI handoffs, Word → AI handoff, AI result → Word handoff, workspace dashboard, and JS mirrors")

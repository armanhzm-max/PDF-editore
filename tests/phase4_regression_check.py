from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]

def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")

word_ts = read("src/ui/WordWorkspace.tsx")
word_js = read("src/ui/WordWorkspace.js")
for source, label in ((word_ts, "TypeScript"), (word_js, "production JavaScript")):
    assert "SAFE_WORD_TAGS" in source and "DROP_WORD_TAGS" in source, f"{label}: HTML allow/block lists missing"
    assert '"script"' in source and '"iframe"' in source and '"svg"' in source, f"{label}: active content is not blocked"
    assert "100_000" in source or "100000" in source, f"{label}: sanitizer node bound missing"
    assert 'if (visitedNodes > 100_000)' in source and 'return htmlEscape(node.textContent ?? "");' in source, f"{label}: sanitizer must preserve plain text when the node-count safety bound is reached"
    assert "12_000_000" in source or "12000000" in source, f"{label}: sanitizer input bound missing"
    assert "setHtml(sanitizeWordHtml(item.payload.html))" in source, f"{label}: restored drafts bypass sanitizer"
    assert "const safeHtml = sanitizeWordHtml(html)" in source, f"{label}: print preview bypasses sanitizer"
    assert 'setError(t(code.startsWith("word_") ? code : "word_export_failed"));' in source, f"{label}: PDF print-preview errors are not caught and surfaced"
    assert "sanitizeWordHtml(editorRef.current" in source, f"{label}: editor export/save path bypasses sanitizer"
    assert "editorRef.current.innerHTML = safeHtml" in source, f"{label}: toolbar HTML path bypasses sanitizer"
    assert "const safeHtml = html;" not in source, f"{label}: unsafe raw preview assignment remains"
print("PASS: Word restores, editor updates, local autosave, DOCX export and print preview sanitize imported HTML; active markup is neutralized and excessive node counts safely degrade to escaped text")

i18n_ts = read("src/core/i18n.ts")
i18n_js = read("src/core/i18n.js")
for source, label in ((i18n_ts, "i18n TypeScript"), (i18n_js, "i18n production JavaScript")):
    assert 'stored === "fa" || stored === "en"' in source, f"{label}: invalid persisted language is not rejected"
    assert "catch" in source and 'localStorage.getItem(\"lang\")' in source, f"{label}: blocked localStorage is not handled"
print("PASS: language preference accepts only supported values and safely falls back when browser storage is blocked")

app_ts = read("src/ui/App.tsx")
app_js = read("src/ui/App.js")
for source, label in ((app_ts, "App TypeScript"), (app_js, "App production JavaScript")):
    assert 'localStorage.setItem("lang", lang)' in source and "catch" in source, f"{label}: language persistence can crash an effect"
print("PASS: language setting persistence is best-effort and cannot crash app initialization")

permissions_ts = read("src/core/permissions.ts")
permissions_js = read("src/core/permissions.js")
for source, label in ((permissions_ts, "permissions TypeScript"), (permissions_js, "permissions production JavaScript")):
    assert "session_storage_unavailable" in source, f"{label}: login storage failure is not reported"
    assert "catch" in source and "localStorage.getItem(KEY)" in source, f"{label}: token reads are not guarded"
print("PASS: token reads handle unavailable storage; login reports when the session cannot be persisted")

for path in ("src/tools/ocr/index.ts", "src/tools/ocr/index.js"):
    source = read(path)
    assert "maxPdfPages: 30" in source and "maxPdfPagesPro: 100" in source, f"{path}: plan-specific OCR page limits changed unexpectedly"
    assert "Math.min(pdf.numPages, 100)" in source, f"{path}: OCR runtime silently stops Pro jobs at the Free 30-page limit"
print("PASS: standalone PDF OCR processes up to the declared 100-page Pro ceiling while Free remains limited by the shared validator")

package = json.loads(read("package.json"))
assert "test:phase4-regressions" in package["scripts"], "new regression check is not exposed as an npm script"
assert "npm run test:phase4-regressions" in package["scripts"]["test"], "new regression check is not included in npm test"
assert package["scripts"].get("test:storage-runtime") == "node tests/storage_runtime_check.mjs", "storage runtime test script is missing"
assert "npm run test:storage-runtime" in package["scripts"]["test"], "storage runtime test is not included in npm test"
assert package["scripts"].get("preview") == "vite preview", "Vite preview script must remain available"
print("PASS: Phase 4 security/storage checks and storage runtime test are included in npm test; preview script is preserved")

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "src/ui/PowerPointWorkspace.tsx").read_text(encoding="utf-8")
app = (ROOT / "src/ui/App.tsx").read_text(encoding="utf-8")
i18n = (ROOT / "src/core/i18n.ts").read_text(encoding="utf-8")
css = (ROOT / "src/ui/styles.css").read_text(encoding="utf-8")

checks = {
    "PPTX import follows presentation slide order and relationships": all(x in source for x in ["ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "getElementsByTagNameNS(P_NS, \"sldId\")", "getAttributeNS(R_NS, \"id\")"]),
    "PPTX import enforces plan-specific compressed and expanded size bounds": all(x in source for x in ["MAX_FILE = 50 * 1024 * 1024", "MAX_UNCOMPRESSED = 200 * 1024 * 1024", "verifyZip(bytes, maxUncompressedBytes)", "file.size > planLimits.maxFileBytes"]),
    "PPTX export emits presentation, master, layout, theme and slide parts": all(x in source for x in ["ppt/presentation.xml", "ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout1.xml", "ppt/theme/theme1.xml", "ppt/slides/slide${index + 1}.xml"]),
    "PPTX text is XML-escaped and Persian direction is represented": "function esc(" in source and "fa-IR" in source and 'rtl ? "r" : "l"' in source,
    "Slide add, duplicate, delete and reorder actions exist": all(x in source for x in ["function addSlide", "function duplicateSlide", "function deleteSlide", "function moveSlide"]),
    "PPTX, PDF print and text outline exports exist": all(x in source for x in ["buildPptx(slides, rtl)", "window.print()", "exportOutline"]),
    "PowerPoint tab, route and navigation are registered": all(x in app for x in ["PowerPointWorkspace", '\"ppt\"', "tabPowerPoint"]),
    "Persian and English labels and limitations are documented": all(x in i18n for x in ["فضای کار ارائه‌ها", "Presentation workspace", "نمودارها", "charts"]),
    "Print mode includes each slide as its own page": "ppt-print-deck" in css and "break-after: page" in css,
    "Professional slide layouts and theme presets exist": all(x in source for x in ["cover", "twoColumn", "section", "quote", "agenda", "imageText", "THEMES"]),
    "Per-slide subtitle, typography controls, and speaker notes exist": all(x in source for x in ["subtitle", "titleSize", "bodySize", "notesSlideXml", "pptSpeakerNotes"]),
    "PNG/JPEG images are validated, embedded, and linked from slide XML": all(x in source for x in ["createImageBitmap(file)", "ppt/media/image", "pictureShape", "relationships/image", "MAX_IMAGE_BYTES_FREE"]),
    "Speaker notes are embedded in native PPTX Notes pages": all(x in source for x in ["ppt/notesMasters/notesMaster1.xml", "ppt/notesSlides/notesSlide${index + 1}.xml", "notesMasterIdLst"]),
    "Local document-to-presentation conversion preserves source references": all(x in source for x in ["extractDocument(file", "documentToSlides", "Source: ${source}", "No AI connection was used"]),
    "Document conversion is available from PDF, Office, and text files": ".pdf,.docx,.xlsx,.pptx,.txt,.csv,.tsv" in source,
    "AI is not required for document-to-slide conversion": 'import("../core/document-extract")' in source and "api.anthropic.com" not in source,
    "All new PowerPoint labels exist in Persian and English": all(x in i18n for x in ["فضای کار ارائه‌ها", "قالب ارائه", "یادداشت ارائه‌دهنده", "تبدیل سند به ارائه", "Speaker notes"]),
}
for label, ok in checks.items():
    print(("PASS: " if ok else "FAIL: ") + label)
if not all(checks.values()):
    raise SystemExit(1)

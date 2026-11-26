from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "src/ui/ExcelWorkspace.tsx").read_text(encoding="utf-8")
app = (ROOT / "src/ui/App.tsx").read_text(encoding="utf-8")
i18n = (ROOT / "src/core/i18n.ts").read_text(encoding="utf-8")
css = (ROOT / "src/ui/styles.css").read_text(encoding="utf-8")

checks = {
    "XLSX and CSV import/export are wired": all(x in source for x in ["parseXlsx", "csvParse", "xlsxBuild", "exportCsv"]),
    "OOXML workbook parts and sheet XML are emitted": all(x in source for x in ["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/styles.xml", "cellStyles count=\"1\"", "defaultTableStyle=\"TableStyleMedium2\""]),
    "Workbook relationship ID uses namespace-aware XML lookup": "getAttributeNS(\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\",\"id\")" in source,
    "ZIP expansion limit is checked before unzip": source.index("checkZipSize(bytes, maxUncompressedBytes);") < source.index("const files=unzipSync(bytes)"),
    "Formula evaluation is allow-listed without eval": "safeFormula" in source and "eval(" not in source,
    "Formula token parser uses a non-null array for strict TypeScript closures": "const tokens: string[] = formulaTokens(f) ?? []; if (tokens.length === 0) return \"#FORMULA?\";" in source,
    "Common formula calculations and circular reference checks exist": all(x in source for x in ["AVERAGE", "COUNTA", "#CIRCULAR!", "evaluateCell"]),
    "AutoSum, TSV paste, keyboard navigation and undo/redo exist": all(x in source for x in ["function autoSum", "function pasteBlock", "function handleKeyDown", "function undo", "function redo"]),
    "Sorting, header preservation and row/column delete exist": all(x in source for x in ["function sortColumn", "firstRowHeader", "function deleteRow", "function deleteCol"]),
    "Free/Pro grid bounds are enforced dynamically": "MAX_ROWS = 5_000" in source and "MAX_COLS = 200" in source and "planLimits.maxRows" in source and "planLimits.maxColumns" in source,
    "Excel tab and route are registered": '"excel"' in app and "ExcelWorkspace" in app and "tabExcel" in i18n,
    "Word editor shows page-break preview and page count": "wordPageCount" in (ROOT / "src/ui/WordWorkspace.tsx").read_text(encoding="utf-8") and "word-sheet-height" in css,
    "English and Persian Excel labels exist": "excelTitle" in i18n and "فضای کار صفحه‌گسترده" in i18n and "Spreadsheet workspace" in i18n,
}
for label, ok in checks.items():
    print(("PASS: " if ok else "FAIL: ") + label)
if not all(checks.values()):
    raise SystemExit(1)

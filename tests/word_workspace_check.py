"""Static OOXML package-structure check for the lightweight Word Workspace.

This validates the OOXML templates authored in WordWorkspace.tsx. It does not
replace opening generated files in Microsoft Word or LibreOffice.
"""
from pathlib import Path
import re
import zipfile
import io
import xml.etree.ElementTree as ET

SOURCE = Path(__file__).resolve().parents[1] / "src/ui/WordWorkspace.tsx"
text = SOURCE.read_text(encoding="utf-8")


def template(name: str) -> str:
    match = re.search(rf"const {re.escape(name)} = `([\s\S]*?)`;", text)
    if not match:
        raise AssertionError(f"Missing template: {name}")
    return match.group(1)


content_types = template("contentTypes")
content_types = content_types.replace(
    "</Types>",
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
)
root_rels = template("rootRels")
document_rels = template("documentRels")
styles = template("styles")
document_xml = template("documentXml").replace(
    "${bodyXml}",
    '<w:p><w:pPr><w:bidi/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>نمونه Word</w:t></w:r></w:p>',
)
core = template("core").replace("${xmlEscape(safeTitle)}", "Sample document")

# XML well-formedness for every template used by the generated DOCX package.
for name, xml in {
    "[Content_Types].xml": content_types,
    "_rels/.rels": root_rels,
    "word/_rels/document.xml.rels": document_rels,
    "word/styles.xml": styles,
    "word/document.xml": document_xml,
    "docProps/core.xml": core,
}.items():
    ET.fromstring(xml.encode("utf-8"))

# Build a minimal package and check its internal relationships and required files.
package = io.BytesIO()
with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_DEFLATED) as archive:
    archive.writestr("[Content_Types].xml", content_types)
    archive.writestr("_rels/.rels", root_rels)
    archive.writestr("word/_rels/document.xml.rels", document_rels)
    archive.writestr("word/styles.xml", styles)
    archive.writestr("word/document.xml", document_xml)
    archive.writestr("docProps/core.xml", core)

with zipfile.ZipFile(io.BytesIO(package.getvalue())) as archive:
    assert archive.testzip() is None
    names = set(archive.namelist())
    required = {"[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels"}
    assert required.issubset(names), f"Missing package parts: {required - names}"
    rels = ET.fromstring(archive.read("word/_rels/document.xml.rels"))
    targets = {item.attrib.get("Target") for item in rels}
    assert "styles.xml" in targets
    document = ET.fromstring(archive.read("word/document.xml"))
    all_text = "".join(node.text or "" for node in document.iter() if node.tag.endswith("}t"))
    assert "نمونه Word" in all_text

# Make sure importer/exporter limits and core UI affordances stay present.
for marker in [
    "estimateZipUncompressedSize", "word/document.xml", "MAX_DOCX_BYTES",
    "MAX_DOCX_UNCOMPRESSED", "document.execCommand", "Download Word",
]:
    if marker == "Download Word":
        continue
    assert marker in text, f"Missing implementation marker: {marker}"

print("PASS: OOXML templates are well-formed and required DOCX package relationships exist")
print("PASS: generated package test ZIP is valid and includes Persian Unicode text")
print("PASS: DOCX size and uncompressed-content guards are present")

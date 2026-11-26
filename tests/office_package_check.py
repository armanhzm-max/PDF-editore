from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET
import shutil

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests/.office-runtime-artifacts"
NS_P = {"p": "http://schemas.openxmlformats.org/presentationml/2006/main", "a": "http://schemas.openxmlformats.org/drawingml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def parse_all_xml(zf):
    for name in zf.namelist():
        if name.endswith(".xml") or name.endswith(".rels"):
            ET.fromstring(zf.read(name))


def check_pptx(path):
    with ZipFile(path) as zf:
        names = set(zf.namelist())
        required = {"[Content_Types].xml", "_rels/.rels", "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "ppt/slideMasters/slideMaster1.xml", "ppt/slideLayouts/slideLayout1.xml", "ppt/theme/theme1.xml", "ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml", "ppt/notesMasters/notesMaster1.xml", "ppt/notesSlides/notesSlide1.xml", "ppt/media/image3.png"}
        assert required <= names, f"Missing PPTX parts: {required - names}"
        parse_all_xml(zf)
        pres = ET.fromstring(zf.read("ppt/presentation.xml"))
        slide_ids = pres.findall(".//p:sldId", NS_P)
        assert len(slide_ids) == 3, "PPTX slide count mismatch"
        text = "".join((node.text or "") for slide in ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"] for node in ET.fromstring(zf.read(slide)).findall(".//a:t", NS_P))
        assert "گزارش فروش" in text and "ممنون از توجه شما" in text and "تصویر و متن" in text, "Persian slide text missing"
        notes = ET.fromstring(zf.read("ppt/notesSlides/notesSlide1.xml"))
        notes_text = "".join(node.text or "" for node in notes.findall(".//a:t", NS_P))
        assert "یادداشت ارائه‌دهنده فارسی" in notes_text, "PPTX speaker notes missing"
        slide3_rels = ET.fromstring(zf.read("ppt/slides/_rels/slide3.xml.rels"))
        assert any(item.attrib.get("Type", "").endswith("/image") for item in slide3_rels), "PPTX image relationship missing"
        rels = ET.fromstring(zf.read("ppt/_rels/presentation.xml.rels"))
        targets = {item.attrib["Target"] for item in rels}
        assert "slides/slide1.xml" in targets and "slides/slide2.xml" in targets
    print("PASS: PPTX ZIP, slide XML, embedded image, speaker notes, relationships and Persian text")


def check_xlsx(path):
    with ZipFile(path) as zf:
        names = set(zf.namelist())
        assert {"[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/styles.xml"} <= names
        styles = ET.fromstring(zf.read("xl/styles.xml"))
        assert styles.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}cellStyles") is not None, "Default Normal cell style missing"
        parse_all_xml(zf)
        sheet = ET.fromstring(zf.read("xl/worksheets/sheet1.xml"))
        formulas = [node.text for node in sheet.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}f")]
        values = [node.text for node in sheet.findall(".//{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v")]
        assert "SUM(D2:D3)" in formulas and "80" in values, "XLSX formula or cached value missing"
    print("PASS: generated XLSX ZIP, XML parts, formula and cached result")


try:
    check_pptx(OUT / "sample.pptx")
    check_xlsx(OUT / "sample.xlsx")
finally:
    shutil.rmtree(OUT, ignore_errors=True)

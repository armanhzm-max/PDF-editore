import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { Icon } from "./icons";
import { getPlanLimits } from "../core/entitlements";
import { createWorkspaceId, loadWorkspaceItem, saveWorkspaceItem } from "../core/local-workspace";
import { saveBlobToDeviceOrDownload } from "../core/device-folder";
import { inspectZipArchive } from "../core/zip-safety.js";
const MAX_FILE = 50 * 1024 * 1024;
const MAX_UNCOMPRESSED = 200 * 1024 * 1024;
const MAX_SLIDES = 120;
const MAX_TEXT = 24000;
const P_NS = "http://schemas.openxmlformats.org/presentationml/2006/main";
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const COLORS = ["0B3B37", "17324D", "49366B", "8A3B32", "E8EFEA", "FFFFFF"];
const THEMES = {
    midnight: { labelFa: "شب مدرن", labelEn: "Midnight", background: "102033", accent: "46D6BD", text: "FFFFFF" },
    ocean: { labelFa: "اقیانوسی", labelEn: "Ocean", background: "103B4A", accent: "F0B35A", text: "FFFFFF" },
    forest: { labelFa: "جنگلی", labelEn: "Forest", background: "15372D", accent: "D9B66F", text: "FFFFFF" },
    sand: { labelFa: "شنی", labelEn: "Sand", background: "F3EBDD", accent: "B45B3D", text: "25312E" },
    minimal: { labelFa: "مینیمال", labelEn: "Minimal", background: "FFFFFF", accent: "087F75", text: "172B29" },
};
const LAYOUTS = ["cover", "content", "section", "twoColumn", "quote", "agenda", "imageText"];
const MAX_IMAGE_BYTES_FREE = 1 * 1024 * 1024;
const MAX_IMAGE_BYTES_PRO = 2 * 1024 * 1024;
function esc(value) { return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;"); }
function safeName(value) { return value.replace(/[\\/:*?"<>|]/g, "-").trim().slice(0, 90) || "Presentation"; }
function normalizePath(path) { const parts = []; for (const part of path.replace(/^\//, "").split("/")) {
    if (!part || part === ".")
        continue;
    if (part === "..")
        parts.pop();
    else
        parts.push(part);
} return parts.join("/"); }
function bytesToBase64(bytes) { let binary = ""; const chunk = 0x8000; for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length))); return btoa(binary); }
function base64ToBytes(value) { const binary = atob(value); const bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i += 1)
    bytes[i] = binary.charCodeAt(i); return bytes; }
function dataUrl(slide) { return slide.imageData && slide.imageMime ? `data:${slide.imageMime};base64,${slide.imageData}` : ""; }
function safeLayout(value) { return LAYOUTS.includes(value) ? value : "content"; }
function normalizeSlide(slide, index) {
    return {
        id: Number.isFinite(slide.id) ? Number(slide.id) : index + 1,
        title: String(slide.title ?? "").slice(0, 300), body: String(slide.body ?? "").slice(0, MAX_TEXT),
        background: /^[0-9A-F]{6}$/i.test(String(slide.background ?? "")) ? String(slide.background) : "FFFFFF",
        accent: /^[0-9A-F]{6}$/i.test(String(slide.accent ?? "")) ? String(slide.accent) : "0B8F83",
        layout: safeLayout(slide.layout), subtitle: String(slide.subtitle ?? "").slice(0, 500), notes: String(slide.notes ?? "").slice(0, 8000),
        source: String(slide.source ?? "").slice(0, 500),
        imageData: typeof slide.imageData === "string" && slide.imageData.length <= 3_000_000 ? slide.imageData : undefined,
        imageMime: slide.imageMime === "image/png" || slide.imageMime === "image/jpeg" ? slide.imageMime : undefined,
        imageRatio: Number.isFinite(slide.imageRatio) && Number(slide.imageRatio) > 0.1 && Number(slide.imageRatio) < 10 ? Number(slide.imageRatio) : 1.5,
        titleSize: [24, 28, 32, 36, 40].includes(Number(slide.titleSize)) ? Number(slide.titleSize) : 32,
        bodySize: [14, 16, 18, 20, 22, 24].includes(Number(slide.bodySize)) ? Number(slide.bodySize) : 18,
    };
}
function verifyZip(bytes, maxUncompressedBytes = MAX_UNCOMPRESSED) {
    inspectZipArchive(bytes, maxUncompressedBytes, {
        invalid: "ppt_bad_file",
        tooLarge: "ppt_too_large",
        tooManyEntries: "ppt_too_many_archive_entries",
        zip64: "ppt_bad_file",
    });
}
function getRelationshipTarget(archive, relPath, relationId, basePath) {
    if (!archive[relPath])
        return undefined;
    const doc = new DOMParser().parseFromString(strFromU8(archive[relPath]), "application/xml");
    if (doc.querySelector("parsererror"))
        return undefined;
    const rel = Array.from(doc.getElementsByTagNameNS(REL_NS, "Relationship")).find(item => item.getAttribute("Id") === relationId);
    const target = rel?.getAttribute("Target");
    return target ? normalizePath(`${basePath}/${target}`) : undefined;
}
export function parsePptx(bytes, maxSlides = MAX_SLIDES, maxUncompressedBytes = MAX_UNCOMPRESSED, maxTextPerSlide = MAX_TEXT, maxImageBytes = MAX_IMAGE_BYTES_PRO) {
    verifyZip(bytes, maxUncompressedBytes);
    const files = unzipSync(bytes);
    const read = (path) => files[path] ? strFromU8(files[path]) : "";
    const presentation = new DOMParser().parseFromString(read("ppt/presentation.xml"), "application/xml");
    if (presentation.querySelector("parsererror"))
        throw new Error("ppt_bad_file");
    const rels = new DOMParser().parseFromString(read("ppt/_rels/presentation.xml.rels"), "application/xml");
    const relations = new Map();
    for (const rel of Array.from(rels.getElementsByTagNameNS(REL_NS, "Relationship"))) {
        const id = rel.getAttribute("Id"), target = rel.getAttribute("Target");
        if (id && target)
            relations.set(id, normalizePath(target.startsWith("/") ? target : `ppt/${target}`));
    }
    const slideIds = Array.from(presentation.getElementsByTagNameNS(P_NS, "sldId"));
    if (!slideIds.length)
        throw new Error("ppt_no_slides");
    if (slideIds.length > maxSlides)
        throw new Error("ppt_too_many_slides");
    return slideIds.map((slideId, index) => {
        const rid = slideId.getAttributeNS(R_NS, "id") || slideId.getAttribute("r:id") || "";
        const path = relations.get(rid);
        if (!path || !path.startsWith("ppt/slides/"))
            throw new Error("ppt_bad_file");
        const doc = new DOMParser().parseFromString(read(path), "application/xml");
        if (doc.querySelector("parsererror"))
            throw new Error("ppt_bad_file");
        const paragraphs = Array.from(doc.getElementsByTagNameNS(A_NS, "p")).map(p => Array.from(p.getElementsByTagNameNS(A_NS, "t")).map(t => t.textContent || "").join("").trim()).filter(Boolean);
        const title = paragraphs.shift() || `Slide ${index + 1}`;
        const body = paragraphs.join("\n").slice(0, maxTextPerSlide);
        let imageData, imageMime, imageRatio = 1.5;
        const blip = doc.getElementsByTagNameNS(A_NS, "blip")[0];
        const embedId = blip?.getAttributeNS(R_NS, "embed") || blip?.getAttribute("r:embed");
        if (embedId) {
            const relPath = path.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
            const imagePath = getRelationshipTarget(files, relPath, embedId, "ppt/slides");
            const imageBytes = imagePath ? files[imagePath] : undefined;
            if (imageBytes && imageBytes.length <= maxImageBytes) {
                const lower = imagePath.toLowerCase();
                if (lower.endsWith(".png"))
                    imageMime = "image/png";
                else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
                    imageMime = "image/jpeg";
                if (imageMime)
                    imageData = bytesToBase64(imageBytes);
            }
            const pic = doc.getElementsByTagNameNS(P_NS, "pic")[0];
            const ext = pic?.getElementsByTagNameNS(A_NS, "ext")[0];
            const cx = Number(ext?.getAttribute("cx")), cy = Number(ext?.getAttribute("cy"));
            if (cx > 0 && cy > 0)
                imageRatio = cx / cy;
        }
        let notes = "";
        const relPath = path.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
        if (files[relPath]) {
            const relDoc = new DOMParser().parseFromString(read(relPath), "application/xml");
            const noteRel = Array.from(relDoc.getElementsByTagNameNS(REL_NS, "Relationship")).find(item => (item.getAttribute("Type") || "").endsWith("/notesSlide"));
            const noteTarget = noteRel?.getAttribute("Target");
            if (noteTarget) {
                const notePath = normalizePath(`ppt/slides/${noteTarget}`);
                if (files[notePath]) {
                    const noteDoc = new DOMParser().parseFromString(strFromU8(files[notePath]), "application/xml");
                    const noteParagraphs = Array.from(noteDoc.getElementsByTagNameNS(A_NS, "p")).map(p => Array.from(p.getElementsByTagNameNS(A_NS, "t")).map(t => t.textContent || "").join("").trim()).filter(Boolean);
                    notes = noteParagraphs.join("\n").slice(0, 8000);
                }
            }
        }
        return normalizeSlide({ id: index + 1, title: title.slice(0, 300), body, background: "FFFFFF", notes, imageData, imageMime, imageRatio, layout: imageData ? "imageText" : "content" }, index);
    });
}
function textShape(id, name, x, y, cx, cy, text, size, bold, rtl, color, align = rtl ? "r" : "l") {
    const paragraphs = (text || "").split("\n").slice(0, 120).map(line => `<a:p><a:pPr algn="${align}"/><a:r><a:rPr lang="${rtl ? "fa-IR" : "en-US"}" sz="${size * 100}"${bold ? " b=\"1\"" : ""}><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:rPr><a:t xml:space="preserve">${esc(line)}</a:t></a:r><a:endParaRPr lang="${rtl ? "fa-IR" : "en-US"}"/></a:p>`).join("") || `<a:p><a:endParaRPr/></a:p>`;
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" anchor="t" lIns="80000" rIns="80000" tIns="50000" bIns="50000"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}
function rectShape(id, name, x, y, cx, cy, color) {
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr></p:sp>`;
}
function pictureShape(id, ratio) {
    const maxW = 4_800_000, maxH = 4_200_000;
    let cx = maxW, cy = cx / Math.max(0.1, ratio);
    if (cy > maxH) {
        cy = maxH;
        cx = cy * ratio;
    }
    const x = 6_700_000 + Math.round((maxW - cx) / 2), y = 1_700_000 + Math.round((maxH - cy) / 2);
    return `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Slide image"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}
function groupTree() { return `<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>`; }
function makeSlideXml(slide, rtl, hasImage) {
    const layout = safeLayout(slide.layout);
    const title = slide.title;
    const body = slide.body;
    const titleColor = slide.background === "FFFFFF" || slide.background === "E8EFEA" || slide.background === "F3EBDD" ? "172B29" : "FFFFFF";
    const bodyColor = titleColor;
    let shapes = "";
    if (layout === "cover") {
        shapes += rectShape(2, "Accent bar", rtl ? 10_750_000 : 620_000, 1_150_000, 120_000, 4_800_000, slide.accent || "0B8F83");
        shapes += textShape(3, "Title", 950_000, 1_650_000, 10_100_000, 1_500_000, title, Math.max(36, slide.titleSize || 40), true, rtl, titleColor, rtl ? "r" : "l");
        shapes += textShape(4, "Subtitle", 1_000_000, 3_350_000, 9_800_000, 2_000_000, slide.subtitle || body, slide.bodySize || 22, false, rtl, bodyColor);
    }
    else if (layout === "section") {
        shapes += rectShape(2, "Section accent", 1_000_000, 3_050_000, 11_000_000, 100_000, slide.accent || "0B8F83");
        shapes += textShape(3, "Section title", 900_000, 1_650_000, 11_200_000, 1_150_000, title, Math.max(34, slide.titleSize || 36), true, rtl, titleColor, "ctr");
        shapes += textShape(4, "Section description", 1_100_000, 3_450_000, 10_800_000, 1_600_000, slide.subtitle || body, slide.bodySize || 20, false, rtl, bodyColor, "ctr");
    }
    else if (layout === "quote") {
        shapes += textShape(2, "Quote", 1_100_000, 1_500_000, 10_700_000, 3_500_000, `“${body}”`, Math.max(24, slide.bodySize || 24), false, rtl, titleColor, "ctr");
        if (title)
            shapes += textShape(3, "Attribution", 1_100_000, 5_150_000, 10_700_000, 850_000, title, 20, true, rtl, slide.accent || "0B8F83", "ctr");
    }
    else if (layout === "twoColumn") {
        const columns = body.split(/\n---\n/);
        shapes += textShape(2, "Title", 650_000, 420_000, 11_000_000, 1_000_000, title, slide.titleSize || 32, true, rtl, titleColor);
        shapes += rectShape(3, "Column divider", 6_030_000, 1_700_000, 35_000, 4_600_000, slide.accent || "0B8F83");
        shapes += textShape(4, "Left column", 700_000, 1_700_000, 5_000_000, 4_500_000, columns[0] || "", slide.bodySize || 18, false, rtl, bodyColor);
        shapes += textShape(5, "Right column", 6_400_000, 1_700_000, 5_000_000, 4_500_000, columns.slice(1).join("\n---\n"), slide.bodySize || 18, false, rtl, bodyColor);
    }
    else if (layout === "imageText" && hasImage) {
        shapes += textShape(2, "Title", 550_000, 480_000, 11_200_000, 1_000_000, title, slide.titleSize || 30, true, rtl, titleColor);
        shapes += textShape(3, "Body", 650_000, 1_800_000, 5_450_000, 4_150_000, body, slide.bodySize || 17, false, rtl, bodyColor);
    }
    else {
        shapes += textShape(2, "Title", 620_000, 520_000, 11_000_000, 1_200_000, title, slide.titleSize || 32, true, rtl, titleColor);
        const top = 2_000_000;
        shapes += textShape(3, "Body", 700_000, top, 10_800_000, 4_450_000, body, slide.bodySize || 18, false, rtl, bodyColor, rtl ? "r" : "l");
    }
    if (slide.source)
        shapes += textShape(8, "Source", 650_000, 6_300_000, 10_800_000, 250_000, `Source: ${slide.source}`, 9, false, rtl, titleColor);
    const image = hasImage ? pictureShape(4, slide.imageRatio || 1.5) : "";
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="${slide.background}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree>${groupTree()}${shapes}${image}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}
function notesSlideXml(text, rtl) {
    const paragraphText = (text || "").split("\n").slice(0, 100).map(line => `<a:p><a:pPr algn="${rtl ? "r" : "l"}"/><a:r><a:rPr lang="${rtl ? "fa-IR" : "en-US"}"/><a:t xml:space="preserve">${esc(line)}</a:t></a:r></a:p>`).join("");
    const placeholder = `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes placeholder"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphText || "<a:p><a:endParaRPr/></a:p>"}</p:txBody></p:sp>`;
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld><p:spTree>${groupTree()}${placeholder}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`;
}
export function buildPptx(slides, rtl) {
    const validSlides = slides.map(normalizeSlide);
    const overrides = validSlides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`).join("");
    const ids = validSlides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join("");
    const presRels = validSlides.map((_, i) => `<Relationship Id="rId${i + 3}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("");
    const defaults = `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>`;
    const entries = {
        "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${defaults}<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/>${overrides}</Types>`),
        "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`),
        "ppt/presentation.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId id="2147483649" r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000" type="wide"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="${rtl ? "fa-IR" : "en-US"}"/></a:defPPr></p:defaultTextStyle></p:presentation>`),
        "ppt/_rels/presentation.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="notesMasters/notesMaster1.xml"/>${presRels}</Relationships>`),
        "ppt/slideMasters/slideMaster1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld><p:spTree>${groupTree()}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="1" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="3200" b="1"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:defPPr><a:defRPr lang="${rtl ? "fa-IR" : "en-US"}"/></a:defPPr></p:otherStyle></p:txStyles></p:sldMaster>`),
        "ppt/slideMasters/_rels/slideMaster1.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`),
        "ppt/slideLayouts/slideLayout1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${groupTree()}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`),
        "ppt/slideLayouts/_rels/slideLayout1.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`),
        "ppt/notesMasters/notesMaster1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notesMaster xmlns:a="${A_NS}" xmlns:r="${R_NS}" xmlns:p="${P_NS}"><p:cSld><p:spTree>${groupTree()}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" indent="0"><a:defRPr sz="1200"/></a:lvl1pPr></p:notesStyle></p:notesMaster>`),
        "ppt/notesMasters/_rels/notesMaster1.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`),
        "ppt/theme/theme1.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="${A_NS}" name="PDF AI Tools"><a:themeElements><a:clrScheme name="PDF AI Tools"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="17324D"/></a:dk2><a:lt2><a:srgbClr val="E8EFEA"/></a:lt2><a:accent1><a:srgbClr val="0B8F83"/></a:accent1><a:accent2><a:srgbClr val="E6A52B"/></a:accent2><a:accent3><a:srgbClr val="6E5AA6"/></a:accent3><a:accent4><a:srgbClr val="C45A4A"/></a:accent4><a:accent5><a:srgbClr val="4A86A8"/></a:accent5><a:accent6><a:srgbClr val="8A9B92"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface="Arial"/><a:cs typeface="Arial"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`),
    };
    validSlides.forEach((slide, index) => {
        const hasImage = Boolean(slide.imageData && slide.imageMime && safeLayout(slide.layout) === "imageText");
        entries[`ppt/slides/slide${index + 1}.xml`] = strToU8(makeSlideXml(slide, rtl, hasImage));
        const rels = [`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];
        if (hasImage) {
            const ext = slide.imageMime === "image/png" ? "png" : "jpg";
            const imageBytes = base64ToBytes(slide.imageData);
            entries[`ppt/media/image${index + 1}.${ext}`] = imageBytes;
            rels.push(`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image${index + 1}.${ext}"/>`);
        }
        rels.push(`<Relationship Id="rId${hasImage ? 3 : 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${index + 1}.xml"/>`);
        entries[`ppt/slides/_rels/slide${index + 1}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL_NS}">${rels.join("")}</Relationships>`);
        entries[`ppt/notesSlides/notesSlide${index + 1}.xml`] = strToU8(notesSlideXml(slide.notes || "", rtl));
        entries[`ppt/notesSlides/_rels/notesSlide${index + 1}.xml.rels`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="../slides/slide${index + 1}.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster" Target="../notesMasters/notesMaster1.xml"/></Relationships>`);
    });
    return zipSync(entries, { level: 6 });
}
function makeSlide(id, title, body = "", background = COLORS[5]) { return normalizeSlide({ id, title, body, background, accent: "0B8F83", layout: "content" }, id - 1); }
export function documentToSlides(extractedText, fileName, format, maxSlides, rtl) {
    const normalized = extractedText.replace(/\r/g, "").trim();
    const marked = normalized.split(/\n(?=\[[^\]]+\])/g).map(part => part.trim()).filter(Boolean);
    const records = marked.length ? marked.map((part, index) => {
        const match = part.match(/^\[([^\]]+)\]\s*/);
        const source = match?.[1] || `${fileName} · ${format} ${index + 1}`;
        const content = match ? part.slice(match[0].length).trim() : part;
        return { source, content };
    }) : normalized.split(/\n{2,}/).map((content, index) => ({ source: `${fileName} · Section ${index + 1}`, content: content.trim() })).filter(item => item.content);
    const groupSize = format === "PDF" ? 1 : format === "PPTX" ? 1 : format === "XLSX" ? 7 : 4;
    const groups = [];
    for (let i = 0; i < records.length; i += groupSize)
        groups.push(records.slice(i, i + groupSize));
    const contentLimit = Math.max(1, maxSlides - 2);
    const selectedGroups = groups.slice(0, contentLimit);
    const accent = "0B8F83";
    const background = "17324D";
    const title = fileName.replace(/\.[^.]+$/, "").slice(0, 100) || (rtl ? "ارائه جدید" : "New presentation");
    const result = [makeSlide(1, title, rtl ? `ارائه از سند ${format}\n${records.length} بخش استخراج‌شده` : `Presentation from ${format} document\n${records.length} extracted sections`, background)];
    result[0] = normalizeSlide({ ...result[0], layout: "cover", accent, notes: rtl ? "این ارائه به‌صورت محلی از محتوای سند ساخته شده است؛ هیچ اتصال هوش مصنوعی استفاده نشده است." : "This deck was generated locally from the source document. No AI connection was used.", source: fileName }, 0);
    if (selectedGroups.length > 2 && result.length < maxSlides - 1) {
        const agenda = selectedGroups.slice(0, 10).map((group, i) => `${i + 1}. ${(group[0]?.content.split("\n")[0] || group[0]?.source || "Section").slice(0, 90)}`).join("\n");
        result.push(normalizeSlide({ id: 2, title: rtl ? "فهرست مطالب" : "Agenda", body: agenda, background: "102033", accent, layout: "agenda", notes: rtl ? "فهرست بخش‌های استخراج‌شده از سند اصلی." : "Sections extracted from the source document." }, 1));
    }
    selectedGroups.forEach((group, index) => {
        const text = group.map(item => item.content).join("\n\n").slice(0, MAX_TEXT);
        const source = group.map(item => item.source).join("; ").slice(0, 400);
        let titleLine;
        let body;
        let layout = "content";
        if (format === "XLSX") {
            // Present spreadsheet rows as paired cell-reference and value columns.
            const sheetMatch = group[0]?.source.match(/·\s*([^!]+)!/);
            titleLine = sheetMatch?.[1]?.trim() || (rtl ? "داده‌های صفحه‌گسترده" : "Spreadsheet data");
            const references = group.map(item => item.source.match(/!([A-Z]{1,3}\d+)/)?.[1] || "").filter(Boolean);
            const values = group.map(item => item.content);
            body = `${references.join("\n")}\n---\n${values.join("\n")}`.slice(0, MAX_TEXT);
            layout = "twoColumn";
        }
        else {
            const firstLine = text.split("\n").map(line => line.trim()).find(Boolean) || group[0]?.source || `Section ${index + 1}`;
            titleLine = firstLine.length > 96 ? `${firstLine.slice(0, 93)}…` : firstLine;
            body = text.startsWith(firstLine) ? text.slice(firstLine.length).trim() || text : text;
        }
        const id = result.length + 1;
        result.push(normalizeSlide({ id, title: titleLine, body, background: index % 2 ? "FFFFFF" : "E8EFEA", accent, layout, notes: `Source: ${source}`, source }, id - 1));
    });
    return result.slice(0, maxSlides);
}
export default function PowerPointWorkspace({ t, lang, plan, savedItemId, onSavedItemLoaded }) {
    const allPlanLimits = getPlanLimits(plan);
    const planLimits = allPlanLimits.powerpoint;
    const documentLimits = allPlanLimits.documents;
    const workspaceLimits = allPlanLimits.workspace;
    const recordId = useRef(createWorkspaceId());
    const hydrating = useRef(false);
    const [localSavedAt, setLocalSavedAt] = useState(0);
    const input = useRef(null);
    const documentInput = useRef(null);
    const imageInput = useRef(null);
    const nextSlideId = useRef(2);
    const rtl = lang === "fa";
    const initialTheme = "midnight";
    const [theme, setTheme] = useState(initialTheme);
    const [slides, setSlides] = useState([normalizeSlide({ id: 1, title: rtl ? "عنوان ارائه" : "Presentation title", body: rtl ? "متن اسلاید خود را اینجا بنویسید" : "Write your slide content here", ...THEMES[initialTheme], layout: "cover" }, 0)]);
    const [selected, setSelected] = useState(0);
    const [name, setName] = useState("Presentation");
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const [dirty, setDirty] = useState(false);
    const [buildingDeck, setBuildingDeck] = useState(false);
    const current = slides[selected] ?? slides[0];
    const slideCount = useMemo(() => slides.length, [slides]);
    const exceedsPlan = useMemo(() => slides.length > planLimits.maxSlides || slides.some(slide => slide.body.length > planLimits.maxTextPerSlide) || new TextEncoder().encode(JSON.stringify({ slides, name })).byteLength > workspaceLimits.maxRecordBytes, [slides, name, planLimits.maxSlides, planLimits.maxTextPerSlide, workspaceLimits.maxRecordBytes]);
    useEffect(() => {
        if (!savedItemId)
            return;
        let cancelled = false;
        hydrating.current = true;
        loadWorkspaceItem(savedItemId).then(item => {
            if (cancelled || !item || item.kind !== "ppt" || !Array.isArray(item.payload.slides) || !item.payload.slides.length)
                return;
            const restored = item.payload.slides.slice(0, MAX_SLIDES).map((slide, index) => normalizeSlide(slide, index));
            recordId.current = item.id;
            nextSlideId.current = Math.max(1, ...restored.map(slide => slide.id)) + 1;
            setSlides(restored);
            setSelected(0);
            setName(typeof item.payload.name === "string" ? item.payload.name : item.name);
            setTheme(item.payload.theme && THEMES[item.payload.theme] ? item.payload.theme : "midnight");
            setDirty(false);
            setLocalSavedAt(item.updatedAt);
            setStatus(lang === "fa" ? "ارائه محلی بازیابی شد." : "Local presentation restored.");
        }).catch(() => setError(lang === "fa" ? "بازیابی ارائه محلی ناموفق بود." : "Could not restore the local presentation.")).finally(() => { hydrating.current = false; onSavedItemLoaded?.(); });
        return () => { cancelled = true; };
    }, [savedItemId]);
    useEffect(() => {
        if (!dirty || hydrating.current || exceedsPlan)
            return;
        const timer = window.setTimeout(() => {
            void saveWorkspaceItem("ppt", name, { slides, name, theme }, recordId.current).then(item => { setLocalSavedAt(item.updatedAt); setDirty(false); }).catch(err => setStatus(err instanceof Error && err.message === "workspace_plan_limit" ? (lang === "fa" ? "ظرفیت فضای کاری پلن فعلی تکمیل شده؛ فایل‌های قبلی حفظ شده‌اند." : "The current plan workspace quota is full; existing files are preserved.") : (lang === "fa" ? "ذخیره خودکار ناموفق بود؛ خروجی PPTX بگیرید." : "Autosave failed; please export a PPTX backup.")));
        }, 900);
        return () => window.clearTimeout(timer);
    }, [dirty, slides, name, theme, lang, exceedsPlan]);
    function updateSlide(patch) { setSlides(old => old.map((slide, index) => index === selected ? { ...slide, ...patch } : slide)); setDirty(true); setStatus(""); }
    function addSlide(layout = "content") { if (slides.length >= planLimits.maxSlides) {
        setError(t("pptLimit"));
        return;
    } const next = normalizeSlide({ id: nextSlideId.current++, title: rtl ? `اسلاید ${slides.length + 1}` : `Slide ${slides.length + 1}`, body: "", background: current?.background ?? COLORS[5], accent: current?.accent ?? "0B8F83", layout }, slides.length); setSlides(old => [...old, next]); setSelected(slides.length); setDirty(true); setError(""); }
    function duplicateSlide() { if (slides.length >= planLimits.maxSlides) {
        setError(t("pptLimit"));
        return;
    } const copy = { ...current, id: nextSlideId.current++, title: `${current.title} (${t("pptCopySuffix")})` }; setSlides(old => [...old.slice(0, selected + 1), copy, ...old.slice(selected + 1)]); setSelected(selected + 1); setDirty(true); }
    function deleteSlide() { if (slides.length <= 1) {
        setError(t("pptKeepOne"));
        return;
    } setSlides(old => old.filter((_, i) => i !== selected)); setSelected(Math.max(0, selected - 1)); setDirty(true); }
    function moveSlide(direction) { const to = selected + direction; if (to < 0 || to >= slides.length)
        return; const next = [...slides]; [next[selected], next[to]] = [next[to], next[selected]]; setSlides(next); setSelected(to); setDirty(true); }
    function applyTheme(key) { const preset = THEMES[key]; setTheme(key); setSlides(old => old.map((slide, index) => ({ ...slide, background: preset.background, accent: preset.accent, titleSize: slide.titleSize || (index === 0 ? 40 : 32) }))); setDirty(true); setStatus(rtl ? "قالب روی همه اسلایدها اعمال شد." : "Theme applied to all slides."); }
    async function openFile(file) { if (!file)
        return; setError(""); setStatus(""); try {
        if (file.size > planLimits.maxFileBytes)
            throw new Error("ppt_file_large");
        if (!file.name.toLowerCase().endsWith(".pptx"))
            throw new Error("ppt_unsupported");
        const parsed = parsePptx(new Uint8Array(await file.arrayBuffer()), planLimits.maxSlides, planLimits.maxUncompressedBytes, planLimits.maxTextPerSlide, plan === "pro" ? MAX_IMAGE_BYTES_PRO : MAX_IMAGE_BYTES_FREE);
        recordId.current = createWorkspaceId();
        setSlides(parsed);
        nextSlideId.current = parsed.length + 1;
        setSelected(0);
        setName(file.name.replace(/\.pptx$/i, "").slice(0, 90) || "Presentation");
        setDirty(true);
        setStatus(t("pptOpened"));
    }
    catch (e) {
        setError(t(e instanceof Error && e.message.startsWith("ppt_") ? e.message : "ppt_open_failed"));
    }
    finally {
        if (input.current)
            input.current.value = "";
    } }
    async function addImage(file) { if (!file)
        return; try {
        const max = plan === "pro" ? MAX_IMAGE_BYTES_PRO : MAX_IMAGE_BYTES_FREE;
        if (file.size > max)
            throw new Error("ppt_image_large");
        if (file.type !== "image/png" && file.type !== "image/jpeg")
            throw new Error("ppt_image_format");
        const bitmap = await createImageBitmap(file);
        const ratio = bitmap.width / bitmap.height;
        bitmap.close();
        const bytes = new Uint8Array(await file.arrayBuffer());
        updateSlide({ imageData: bytesToBase64(bytes), imageMime: file.type, imageRatio: ratio, layout: "imageText" });
        setStatus(t("pptImageAdded"));
    }
    catch (e) {
        const key = e instanceof Error && ["ppt_image_large", "ppt_image_format"].includes(e.message) ? e.message : "ppt_image_invalid";
        setError(t(key));
    }
    finally {
        if (imageInput.current)
            imageInput.current.value = "";
    } }
    async function createFromDocument(file) { if (!file)
        return; setBuildingDeck(true); setError(""); setStatus(""); try {
        const { extractDocument } = await import("../core/document-extract");
        const extracted = await extractDocument(file, { maxFileBytes: documentLimits.maxFileBytes, maxUncompressedBytes: documentLimits.maxUncompressedBytes, maxPdfPages: Math.min(documentLimits.maxPdfPages, planLimits.maxSlides * 3) });
        const generated = documentToSlides(extracted.text, file.name, extracted.format, planLimits.maxSlides, rtl);
        recordId.current = createWorkspaceId();
        nextSlideId.current = generated.length + 1;
        setSlides(generated);
        setSelected(0);
        setName(file.name.replace(/\.[^.]+$/, "").slice(0, 90) || "Presentation");
        setTheme("ocean");
        setDirty(true);
        setStatus(rtl ? `ارائه از ${extracted.format} به‌صورت محلی ساخته شد؛ ${generated.length} اسلاید آماده است.` : `A local presentation was generated from ${extracted.format}; ${generated.length} slides are ready.`);
    }
    catch (e) {
        const rawKey = e instanceof Error ? e.message : "ppt_document_failed";
        const key = rawKey === "document_file_too_large" ? "document_file_large" : rawKey;
        setError(key.startsWith("document_") ? t(`docError.${key}`) : t(key));
    }
    finally {
        setBuildingDeck(false);
        if (documentInput.current)
            documentInput.current.value = "";
    } }
    function download(bytes, file, mime) { const owned = new ArrayBuffer(bytes.byteLength); new Uint8Array(owned).set(bytes); void saveBlobToDeviceOrDownload(new Blob([owned], { type: mime }), file); }
    function exportPptx() { try {
        const bytes = buildPptx(slides, rtl);
        download(bytes, `${safeName(name)}.pptx`, "application/vnd.openxmlformats-officedocument.presentationml.presentation");
        setDirty(true);
        setStatus(t("pptSaved"));
    }
    catch {
        setError(t("pptExportFailed"));
    } }
    function exportOutline() { const text = slides.map((s, i) => `${i + 1}. ${s.title}\n${s.body}${s.source ? `\nSource: ${s.source}` : ""}${s.notes ? `\n\nSpeaker notes:\n${s.notes}` : ""}`).join("\n\n"); download(new TextEncoder().encode("\ufeff" + text), `${safeName(name)}-outline-and-notes.txt`, "text/plain;charset=utf-8"); setStatus(t("pptOutlineSaved")); }
    function newPresentation() { recordId.current = createWorkspaceId(); nextSlideId.current = 2; const preset = THEMES[theme]; setSlides([normalizeSlide({ id: 1, title: rtl ? "عنوان ارائه" : "Presentation title", body: rtl ? "متن اسلاید خود را اینجا بنویسید" : "Write your slide content here", ...preset, layout: "cover", titleSize: 40 }, 0)]); setSelected(0); setName("Presentation"); setDirty(true); setError(""); }
    const previewImage = current?.imageData && current.imageMime ? dataUrl(current) : "";
    return _jsxs("section", { className: "ppt-page ppt-page-pro", children: [exceedsPlan && _jsxs("div", { className: "plan-over-limit-note", role: "status", children: [_jsx(Icon, { name: "lock", size: 16 }), _jsx("span", { children: rtl ? "این ارائه با سقف بالاتر ساخته شده است و همه اسلایدها حفظ شده‌اند. برای ویرایش با همان ظرفیت، پلن Pro را فعال کنید." : "This deck exceeds the current plan limits. Existing slides are preserved; restore Pro to edit at the original capacity." })] }), _jsxs("div", { className: "ppt-intro", children: [_jsx("div", { className: "ppt-icon", children: _jsx(Icon, { name: "powerpoint", size: 28 }) }), _jsxs("div", { children: [_jsx("h2", { children: t("pptTitle") }), _jsx("p", { className: "muted", children: t("pptIntroPro") }), _jsx("p", { className: "small muted", children: rtl ? `پلن ${plan === "pro" ? "Pro" : "Free"}: ${planLimits.maxSlides} اسلاید، ${Math.round(planLimits.maxFileBytes / 1048576)} مگابایت` : `${plan === "pro" ? "Pro" : "Free"}: ${planLimits.maxSlides} slides, ${Math.round(planLimits.maxFileBytes / 1048576)} MB` }), _jsxs("p", { className: "ppt-privacy", children: [_jsx(Icon, { name: "shield", size: 15 }), t("pptPrivacy")] })] })] }), _jsxs("div", { className: "ppt-filebar", children: [_jsxs("div", { className: "ppt-actions", children: [_jsxs("button", { className: "primary", onClick: () => input.current?.click(), children: [_jsx(Icon, { name: "upload", size: 16 }), t("pptOpen")] }), _jsxs("button", { onClick: newPresentation, children: [_jsx(Icon, { name: "plus", size: 16 }), t("pptNew")] }), _jsxs("button", { className: "ppt-convert-btn", onClick: () => documentInput.current?.click(), disabled: buildingDeck, children: [_jsx(Icon, { name: "file-sparkles", size: 16 }), buildingDeck ? t("pptConverting") : t("pptConvertDocument")] }), _jsx("input", { ref: input, hidden: true, type: "file", accept: ".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation", onChange: e => openFile(e.target.files?.[0]) }), _jsx("input", { ref: documentInput, hidden: true, type: "file", accept: ".pdf,.docx,.xlsx,.pptx,.txt,.csv,.tsv", onChange: e => createFromDocument(e.target.files?.[0]) })] }), _jsxs("label", { children: [t("pptName"), _jsx("input", { value: name, maxLength: 90, readOnly: exceedsPlan, onChange: e => { setName(e.target.value); setDirty(true); } })] })] }), _jsxs("div", { className: "ppt-theme-panel", children: [_jsx("strong", { children: t("pptThemes") }), _jsx("div", { className: "ppt-theme-options", children: Object.keys(THEMES).map(key => _jsxs("button", { type: "button", className: `ppt-theme-chip ${theme === key ? "active" : ""}`, onClick: () => applyTheme(key), children: [_jsx("span", { style: { background: `#${THEMES[key].background}`, borderColor: `#${THEMES[key].accent}` } }), rtl ? THEMES[key].labelFa : THEMES[key].labelEn] }, key)) }), _jsx("small", { children: t("pptThemeHint") })] }), _jsxs("div", { className: "ppt-workspace", children: [_jsxs("aside", { className: "ppt-sidebar", children: [_jsxs("div", { className: "ppt-sidebar-head", children: [_jsxs("strong", { children: [t("pptSlides"), " (", slideCount, ")"] }), _jsx("button", { onClick: () => addSlide(), "aria-label": t("pptAddSlide"), children: _jsx(Icon, { name: "plus", size: 16 }) })] }), slides.map((slide, index) => _jsxs("button", { className: `ppt-thumb ${index === selected ? "active" : ""}`, onClick: () => setSelected(index), children: [_jsx("span", { children: index + 1 }), _jsx("strong", { children: slide.title || t("pptUntitledSlide") }), _jsxs("small", { children: [slide.layout || "content", " \u00B7 ", slide.body.slice(0, 56)] }), slide.imageData && _jsx("em", { children: t("pptImageAttached") })] }, slide.id))] }), _jsxs("div", { className: "ppt-editor", children: [_jsxs("div", { className: "ppt-editor-toolbar", children: [_jsx("button", { onClick: () => addSlide(), children: t("pptAddSlide") }), _jsx("button", { onClick: duplicateSlide, children: t("pptDuplicate") }), _jsx("button", { onClick: () => moveSlide(-1), disabled: selected === 0, children: t("pptMoveUp") }), _jsx("button", { onClick: () => moveSlide(1), disabled: selected === slides.length - 1, children: t("pptMoveDown") }), _jsx("button", { onClick: deleteSlide, disabled: slides.length <= 1, children: t("pptDelete") })] }), _jsxs("article", { className: `ppt-slide-preview ppt-layout-${current.layout || "content"} ${["FFFFFF", "E8EFEA", "F3EBDD"].includes(current.background) ? "light" : "dark"}`, style: { backgroundColor: `#${current.background}`, direction: rtl ? "rtl" : "ltr", "--ppt-accent": `#${current.accent || "0B8F83"}` }, children: [_jsx("span", { className: "ppt-accent-line" }), current.layout === "cover" ? _jsxs(_Fragment, { children: [_jsx("h1", { children: current.title }), _jsx("p", { children: current.subtitle || current.body })] }) : current.layout === "section" ? _jsxs(_Fragment, { children: [_jsx("h1", { children: current.title }), _jsx("p", { children: current.subtitle || current.body })] }) : current.layout === "quote" ? _jsxs(_Fragment, { children: [_jsxs("p", { className: "ppt-quote-text", children: ["\u201C", current.body, "\u201D"] }), _jsx("h1", { className: "ppt-quote-author", children: current.title })] }) : current.layout === "twoColumn" ? _jsxs(_Fragment, { children: [_jsx("h1", { children: current.title }), _jsx("div", { className: "ppt-preview-columns", children: (current.body.split("\n---\n").length > 1 ? current.body.split("\n---\n") : [current.body, ""]).slice(0, 2).map((col, index) => _jsx("p", { children: col }, index)) })] }) : current.layout === "imageText" ? _jsxs(_Fragment, { children: [_jsx("h1", { children: current.title }), _jsxs("div", { className: "ppt-preview-image-body", children: [_jsx("p", { children: current.body }), previewImage && _jsx("img", { src: previewImage, alt: t("pptSlideImage") })] })] }) : _jsxs(_Fragment, { children: [_jsx("h1", { children: current.title }), _jsx("p", { children: current.body })] }), current.source && _jsxs("small", { className: "ppt-preview-source", children: [rtl ? "منبع: " : "Source: ", current.source] }), _jsxs("span", { className: "ppt-preview-number", children: [selected + 1, " / ", slides.length] })] }), _jsxs("div", { className: "ppt-fields ppt-fields-pro", children: [_jsxs("label", { children: [t("pptLayout"), _jsx("select", { value: current.layout || "content", onChange: e => updateSlide({ layout: e.target.value }), children: LAYOUTS.map(layout => _jsx("option", { value: layout, children: t(`pptLayout_${layout}`) }, layout)) })] }), _jsxs("label", { children: [t("pptSlideTitle"), _jsx("input", { maxLength: 300, value: current.title, onChange: e => updateSlide({ title: e.target.value }) })] }), (current.layout === "cover" || current.layout === "section") && _jsxs("label", { children: [t("pptSubtitle"), _jsx("input", { maxLength: 500, value: current.subtitle || "", onChange: e => updateSlide({ subtitle: e.target.value }) })] }), _jsxs("label", { children: [t("pptSlideBody"), _jsx("textarea", { rows: 7, maxLength: Math.max(planLimits.maxTextPerSlide, current.body.length), value: current.body, onChange: e => { const value = e.target.value; if (value.length > planLimits.maxTextPerSlide && value.length > current.body.length)
                                                    return; updateSlide({ body: value }); } })] }), current.layout === "twoColumn" && _jsx("small", { className: "muted", children: t("pptTwoColumnHint") }), _jsxs("div", { className: "ppt-control-row", children: [_jsxs("label", { children: [t("pptTitleSize"), _jsx("select", { value: current.titleSize || 32, onChange: e => updateSlide({ titleSize: Number(e.target.value) }), children: [24, 28, 32, 36, 40].map(v => _jsxs("option", { value: v, children: [v, " pt"] }, v)) })] }), _jsxs("label", { children: [t("pptBodySize"), _jsx("select", { value: current.bodySize || 18, onChange: e => updateSlide({ bodySize: Number(e.target.value) }), children: [14, 16, 18, 20, 22, 24].map(v => _jsxs("option", { value: v, children: [v, " pt"] }, v)) })] })] }), _jsxs("div", { className: "ppt-colors", children: [_jsx("span", { children: t("pptBackground") }), COLORS.map(color => _jsx("button", { type: "button", "aria-label": `${t("pptBackground")} ${color}`, title: color, style: { backgroundColor: `#${color}` }, className: current.background === color ? "chosen" : "", onClick: () => updateSlide({ background: color }) }, color))] }), _jsxs("div", { className: "ppt-image-tools", children: [_jsx("strong", { children: t("pptSlideImage") }), _jsxs("button", { type: "button", onClick: () => imageInput.current?.click(), children: [_jsx(Icon, { name: "image-plus", size: 16 }), t("pptAddImage")] }), current.imageData && _jsx("button", { type: "button", onClick: () => updateSlide({ imageData: undefined, imageMime: undefined, imageRatio: undefined }), children: t("pptRemoveImage") }), _jsx("input", { ref: imageInput, hidden: true, type: "file", accept: "image/png,image/jpeg,.png,.jpg,.jpeg", onChange: e => addImage(e.target.files?.[0]) }), _jsx("small", { children: t("pptImageHint") })] }), _jsxs("label", { children: [t("pptSpeakerNotes"), _jsx("textarea", { rows: 4, maxLength: 8000, value: current.notes || "", onChange: e => updateSlide({ notes: e.target.value }) })] })] })] })] }), _jsxs("div", { className: "ppt-exportbar", children: [_jsxs("div", { children: [_jsxs("button", { className: "primary", onClick: exportPptx, children: [_jsx(Icon, { name: "download", size: 16 }), t("pptExport")] }), _jsx("button", { onClick: () => window.print(), children: t("pptPrintPdf") }), _jsx("button", { onClick: exportOutline, children: t("pptOutline") })] }), _jsx("span", { children: dirty ? t("pptUnsaved") : localSavedAt ? (rtl ? "ذخیره خودکار روی این دستگاه" : "Auto-saved on this device") : status || t("pptReady") })] }), _jsx("div", { className: "ppt-print-deck", children: slides.map((slide, index) => _jsxs("article", { className: `ppt-slide-preview ppt-layout-${slide.layout || "content"} ${["FFFFFF", "E8EFEA", "F3EBDD"].includes(slide.background) ? "light" : "dark"}`, style: { backgroundColor: `#${slide.background}`, direction: rtl ? "rtl" : "ltr", "--ppt-accent": `#${slide.accent || "0B8F83"}` }, children: [_jsx("span", { className: "ppt-accent-line" }), _jsx("h1", { children: slide.title }), slide.imageData && slide.imageMime && _jsx("img", { className: "ppt-print-image", src: dataUrl(slide), alt: "" }), _jsx("p", { children: slide.body }), _jsxs("span", { className: "ppt-preview-number", children: [index + 1, " / ", slides.length] })] }, slide.id)) }), error && _jsx("p", { className: "error", role: "alert", children: error }), status && _jsx("p", { className: "ppt-status", role: "status", children: status }), _jsxs("p", { className: "ppt-note", children: [_jsx(Icon, { name: "info", size: 16 }), t("pptLimitationsPro")] })] });
}

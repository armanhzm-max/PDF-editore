import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { toOwnedArrayBuffer } from "../core/bytes";
import { getPlanLimits } from "../core/entitlements";
import { createWorkspaceId, loadWorkspaceItem, saveWorkspaceItem } from "../core/local-workspace";
import { saveBlobToDeviceOrDownload } from "../core/device-folder";
import { inspectZipArchive } from "../core/zip-safety.js";
import { Icon } from "./icons";
const MAX_DOCX_BYTES = 40 * 1024 * 1024;
const MAX_DOCX_UNCOMPRESSED = 200 * 1024 * 1024;
const MAX_EDITABLE_CHARS = 4_000_000;
function xmlEscape(value) {
    return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function htmlEscape(value) {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const SAFE_WORD_TAGS = new Set([
    "p", "div", "span", "br", "h1", "h2", "h3", "h4", "h5", "h6",
    "strong", "b", "em", "i", "u", "s", "strike", "del", "sub", "sup",
    "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "td", "th",
    "blockquote", "pre", "code", "font", "a",
]);
const DROP_WORD_TAGS = new Set([
    "script", "style", "iframe", "object", "embed", "svg", "math", "template",
    "noscript", "form", "input", "button", "select", "textarea", "video", "audio",
    "canvas", "img", "meta", "link", "base", "head",
]);
/**
 * Restore/import content is untrusted: only rebuild a small formatting allow-list.
 * Event attributes, URLs, embedded content and arbitrary CSS are never copied.
 */
function sanitizeWordHtml(input) {
    if (input.length > 12_000_000)
        throw new Error("word_document_too_large");
    const parsed = new DOMParser().parseFromString(input, "text/html");
    const cleanStyle = (raw) => {
        const output = [];
        for (const declaration of raw.split(";")) {
            const colon = declaration.indexOf(":");
            if (colon < 1)
                continue;
            const property = declaration.slice(0, colon).trim().toLowerCase();
            const value = declaration.slice(colon + 1).trim();
            if (property === "color") {
                const color = parseCssColor(value);
                if (color)
                    output.push(`color:#${color}`);
            }
            else if (property === "font-size") {
                const match = /^(\d{1,2}(?:\.\d{1,2})?)(pt|px)$/i.exec(value);
                const size = match ? Number(match[1]) * (match[2].toLowerCase() === "px" ? 0.75 : 1) : 0;
                if (size >= 5 && size <= 72)
                    output.push(`font-size:${size}pt`);
            }
            else if (property === "font-weight" && /^(bold|[6-9]00)$/i.test(value)) {
                output.push("font-weight:bold");
            }
            else if (property === "font-style" && /^italic$/i.test(value)) {
                output.push("font-style:italic");
            }
            else if (property === "text-align" && /^(left|right|center|justify)$/i.test(value)) {
                output.push(`text-align:${value.toLowerCase()}`);
            }
            else if (property === "text-decoration" || property === "text-decoration-line") {
                const decorations = value.toLowerCase().split(/\s+/).filter((part) => part === "underline" || part === "line-through");
                if (decorations.length)
                    output.push(`text-decoration:${decorations.join(" ")}`);
            }
            else if (property === "direction" && /^(ltr|rtl)$/i.test(value)) {
                output.push(`direction:${value.toLowerCase()}`);
            }
            else if (property === "white-space" && /^(pre|pre-wrap|pre-line)$/i.test(value)) {
                output.push(`white-space:${value.toLowerCase()}`);
            }
        }
        return output.join(";");
    };
    let visitedNodes = 0;
    const cleanNode = (node, depth = 0) => {
        visitedNodes += 1;
        if (visitedNodes > 100_000)
            return htmlEscape(node.textContent ?? "");
        if (depth > 80)
            return htmlEscape(node.textContent ?? "");
        if (node.nodeType === Node.TEXT_NODE)
            return htmlEscape(node.textContent ?? "");
        if (node.nodeType !== Node.ELEMENT_NODE)
            return "";
        const element = node;
        const tag = element.tagName.toLowerCase();
        if (DROP_WORD_TAGS.has(tag))
            return "";
        const children = Array.from(element.childNodes).map((child) => cleanNode(child, depth + 1)).join("");
        if (!SAFE_WORD_TAGS.has(tag))
            return children;
        if (tag === "br")
            return "<br>";
        const attributes = [];
        const direction = element.getAttribute("dir")?.toLowerCase();
        if (direction === "rtl" || direction === "ltr" || direction === "auto")
            attributes.push(`dir="${direction}"`);
        const style = cleanStyle(element.getAttribute("style") ?? "");
        if (style)
            attributes.push(`style="${htmlEscape(style)}"`);
        if (tag === "td" || tag === "th") {
            for (const key of ["colspan", "rowspan"]) {
                const raw = element.getAttribute(key) ?? "";
                if (/^\d{1,2}$/.test(raw)) {
                    const value = Number(raw);
                    const max = key === "colspan" ? 12 : 20;
                    if (value >= 1 && value <= max)
                        attributes.push(`${key}="${value}"`);
                }
            }
        }
        if (tag === "ol") {
            const start = element.getAttribute("start") ?? "";
            if (/^\d{1,4}$/.test(start) && Number(start) >= 1)
                attributes.push(`start="${Number(start)}"`);
        }
        if (tag === "font") {
            const color = parseCssColor(element.getAttribute("color") ?? "");
            if (color)
                attributes.push(`color="#${color}"`);
            const size = element.getAttribute("size") ?? "";
            if (/^[1-7]$/.test(size))
                attributes.push(`size="${size}"`);
        }
        return `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}>${children}</${tag}>`;
    };
    return Array.from(parsed.body.childNodes).map(cleanNode).join("") || "<p><br></p>";
}
function localChildren(element, name) {
    return Array.from(element.children).filter((child) => !name || child.localName === name);
}
function firstLocal(element, name) {
    return localChildren(element, name)[0] ?? null;
}
function attrVal(element, name) {
    if (!element)
        return "";
    return element.getAttributeNS("http://schemas.openxmlformats.org/wordprocessingml/2006/main", name)
        ?? element.getAttribute(`w:${name}`) ?? element.getAttribute(name) ?? "";
}
function hasWordFlag(element) {
    if (!element)
        return false;
    const value = attrVal(element, "val");
    return value !== "0" && value !== "false" && value !== "off";
}
function findElements(root, localName) {
    return Array.from(root.querySelectorAll("*")).filter((element) => element.localName === localName);
}
function estimateZipUncompressedSize(bytes, maxUncompressedBytes = MAX_DOCX_UNCOMPRESSED) {
    return inspectZipArchive(bytes, maxUncompressedBytes, {
        invalid: "word_invalid_docx",
        tooLarge: "word_uncompressed_too_large",
        tooManyEntries: "word_too_many_archive_entries",
        zip64: "word_unsupported_zip64",
    });
}
function containsRtl(text) {
    return /[\u0590-\u08FF\uFB1D-\uFEFC]/.test(text);
}
function parseRun(run) {
    const props = firstLocal(run, "rPr");
    const runProps = props ?? run;
    const bold = hasWordFlag(firstLocal(runProps, "b"));
    const italic = hasWordFlag(firstLocal(runProps, "i"));
    const underline = hasWordFlag(firstLocal(runProps, "u"));
    const strike = hasWordFlag(firstLocal(runProps, "strike")) || hasWordFlag(firstLocal(runProps, "dstrike"));
    const colorEl = firstLocal(props ?? run, "color");
    const sizeEl = firstLocal(props ?? run, "sz");
    const color = attrVal(colorEl, "val");
    const size = Number(attrVal(sizeEl, "val")) / 2;
    let value = "";
    for (const child of Array.from(run.children)) {
        if (child.localName === "t" || child.localName === "delText" || child.localName === "instrText")
            value += htmlEscape(child.textContent ?? "");
        else if (child.localName === "tab")
            value += "&emsp;";
        else if (child.localName === "br" || child.localName === "cr")
            value += "<br>";
    }
    if (!value)
        return "";
    if (bold)
        value = `<strong>${value}</strong>`;
    if (italic)
        value = `<em>${value}</em>`;
    if (underline)
        value = `<u>${value}</u>`;
    if (strike)
        value = `<s>${value}</s>`;
    const styles = [];
    if (/^[0-9A-Fa-f]{6}$/.test(color) && color.toLowerCase() !== "auto")
        styles.push(`color:#${color}`);
    if (Number.isFinite(size) && size >= 5 && size <= 96)
        styles.push(`font-size:${size}pt`);
    if (styles.length)
        value = `<span style="${styles.join(";")}">${value}</span>`;
    return value;
}
function parseParagraph(paragraph, numbering) {
    const pPr = firstLocal(paragraph, "pPr");
    const styleId = attrVal(firstLocal(pPr ?? paragraph, "pStyle"), "val");
    const heading = /^(?:Heading|heading)([1-6])$/.exec(styleId);
    const isTitle = /^(?:Title|Subtitle)$/i.test(styleId);
    const jc = attrVal(firstLocal(pPr ?? paragraph, "jc"), "val");
    const alignment = jc === "center" ? "center" : jc === "right" || jc === "end" ? "right" : jc === "both" || jc === "distribute" ? "justify" : "left";
    const bidi = !!firstLocal(pPr ?? paragraph, "bidi");
    const text = Array.from(paragraph.children).filter((child) => child.localName === "r" || child.localName === "hyperlink" || child.localName === "smartTag")
        .map((child) => child.localName === "r" ? parseRun(child) : Array.from(child.children).map(parseRun).join("")).join("");
    const listPr = firstLocal(pPr ?? paragraph, "numPr");
    const numId = attrVal(firstLocal(listPr ?? paragraph, "numId"), "val");
    const list = numId ? (numbering.get(numId) ?? "ul") : null;
    const dir = bidi || containsRtl(paragraph.textContent ?? "") ? "rtl" : "ltr";
    const style = [`text-align:${alignment}`];
    if (dir === "rtl")
        style.push("direction:rtl");
    const content = text || "<br>";
    if (list)
        return { html: `<li dir="${dir}" style="${style.join(";")}">${content}</li>`, list };
    const tag = heading ? `h${heading[1]}` : isTitle ? (styleId.toLowerCase() === "title" ? "h1" : "h3") : "p";
    return { html: `<${tag} dir="${dir}" style="${style.join(";")}">${content}</${tag}>`, list: null };
}
function parseTable(table, numbering) {
    const rows = localChildren(table, "tr").map((row) => {
        const cells = localChildren(row).filter((cell) => cell.localName === "tc").map((cell) => {
            const blocks = localChildren(cell).map((child) => {
                if (child.localName === "p")
                    return parseParagraph(child, numbering).html.replace(/^<li[^>]*>/, "<p>").replace(/<\/li>$/, "</p>");
                if (child.localName === "tbl")
                    return parseTable(child, numbering);
                return "";
            }).join("") || "<p><br></p>";
            return `<td>${blocks}</td>`;
        }).join("");
        return `<tr>${cells}</tr>`;
    }).join("");
    return `<table><tbody>${rows}</tbody></table>`;
}
function docxToHtml(bytes, maxUncompressedBytes = MAX_DOCX_UNCOMPRESSED, maxCharacters = MAX_EDITABLE_CHARS) {
    estimateZipUncompressedSize(bytes, maxUncompressedBytes);
    const files = unzipSync(bytes);
    const documentBytes = files["word/document.xml"];
    if (!documentBytes)
        throw new Error("word_invalid_docx");
    const xml = new DOMParser().parseFromString(strFromU8(documentBytes), "application/xml");
    if (xml.querySelector("parsererror"))
        throw new Error("word_invalid_docx");
    const numbering = new Map();
    if (files["word/numbering.xml"]) {
        const numberingXml = new DOMParser().parseFromString(strFromU8(files["word/numbering.xml"]), "application/xml");
        const abstractKinds = new Map();
        for (const abstract of findElements(numberingXml, "abstractNum")) {
            const id = attrVal(abstract, "abstractNumId");
            const fmtNode = findElements(abstract, "numFmt")[0] ?? null;
            const fmt = attrVal(fmtNode, "val");
            abstractKinds.set(id, fmt === "bullet" ? "ul" : "ol");
        }
        for (const num of findElements(numberingXml, "num")) {
            const id = attrVal(num, "numId");
            const abstractId = attrVal(firstLocal(num, "abstractNumId"), "val");
            numbering.set(id, abstractKinds.get(abstractId) ?? "ul");
        }
    }
    const body = findElements(xml, "body")[0];
    if (!body)
        throw new Error("word_invalid_docx");
    const output = [];
    let openList = null;
    const closeList = () => { if (openList)
        output.push(`</${openList}>`); openList = null; };
    for (const child of Array.from(body.children)) {
        if (child.localName === "p") {
            const parsed = parseParagraph(child, numbering);
            if (parsed.list) {
                if (openList !== parsed.list) {
                    closeList();
                    output.push(`<${parsed.list}>`);
                    openList = parsed.list;
                }
                output.push(parsed.html);
            }
            else {
                closeList();
                output.push(parsed.html);
            }
        }
        else if (child.localName === "tbl") {
            closeList();
            output.push(parseTable(child, numbering));
        }
    }
    closeList();
    const html = output.join("").trim();
    if (html.length > maxCharacters * 3)
        throw new Error("word_document_too_large");
    return html || "<p><br></p>";
}
function parseCssColor(value) {
    const hex = value.match(/^#([0-9a-f]{6})$/i);
    if (hex)
        return hex[1].toUpperCase();
    const rgb = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (rgb)
        return rgb.slice(1).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0")).join("").toUpperCase();
    return undefined;
}
function htmlInlineToRuns(node, inherited = {}, rtl = false) {
    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        if (!text)
            return "";
        const style = `${inherited.bold ? "<w:b/><w:bCs/>" : ""}${inherited.italic ? "<w:i/><w:iCs/>" : ""}${inherited.underline ? '<w:u w:val="single"/>' : ""}${inherited.strike ? "<w:strike/>" : ""}${inherited.color ? `<w:color w:val="${inherited.color}"/>` : ""}${inherited.size ? `<w:sz w:val="${Math.round(inherited.size * 2)}"/><w:szCs w:val="${Math.round(inherited.size * 2)}"/>` : ""}${rtl ? "<w:rtl/>" : ""}`;
        return `<w:r><w:rPr>${style}<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
    }
    if (node.nodeType !== Node.ELEMENT_NODE)
        return "";
    const element = node;
    const tag = element.tagName.toLowerCase();
    if (tag === "br")
        return "<w:r><w:br/></w:r>";
    if (tag === "img" || tag === "script" || tag === "style")
        return "";
    const next = { ...inherited };
    if (tag === "strong" || tag === "b")
        next.bold = true;
    if (tag === "em" || tag === "i")
        next.italic = true;
    if (tag === "u")
        next.underline = true;
    if (tag === "s" || tag === "strike" || tag === "del")
        next.strike = true;
    const inlineStyle = element.getAttribute("style") ?? "";
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(inlineStyle))
        next.bold = true;
    if (/font-style\s*:\s*italic/i.test(inlineStyle))
        next.italic = true;
    if (/text-decoration[^;]*underline/i.test(inlineStyle))
        next.underline = true;
    if (/text-decoration[^;]*line-through/i.test(inlineStyle))
        next.strike = true;
    const color = parseCssColor((inlineStyle.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i)?.[1] ?? "").trim());
    if (color)
        next.color = color;
    const sizeText = inlineStyle.match(/font-size\s*:\s*([\d.]+)\s*(pt|px)/i);
    if (sizeText) {
        const parsed = Number(sizeText[1]) * (sizeText[2].toLowerCase() === "px" ? 0.75 : 1);
        if (parsed >= 5 && parsed <= 72)
            next.size = parsed;
    }
    if (tag === "font") {
        const fontColor = parseCssColor(element.getAttribute("color") ?? "");
        if (fontColor)
            next.color = fontColor;
        const legacySizes = { "1": 8, "2": 10, "3": 12, "4": 14, "5": 18, "6": 24, "7": 36 };
        const legacySize = legacySizes[element.getAttribute("size") ?? ""];
        if (legacySize)
            next.size = legacySize;
    }
    return Array.from(element.childNodes).map((child) => htmlInlineToRuns(child, next, rtl)).join("");
}
function paragraphXml(element, content, extraPrefix = "") {
    const styleId = /^H([1-6])$/.exec(element.tagName.toUpperCase());
    const text = element.textContent ?? "";
    const rtl = element.getAttribute("dir") === "rtl" || containsRtl(text);
    const css = element.getAttribute("style") ?? "";
    const alignment = css.match(/text-align\s*:\s*(left|right|center|justify)/i)?.[1]?.toLowerCase();
    const jc = alignment ? `<w:jc w:val="${alignment === "left" ? "left" : alignment}"/>` : "";
    const style = styleId ? `<w:pStyle w:val="Heading${styleId[1]}"/>` : "";
    const bidi = rtl ? "<w:bidi/>" : "";
    const runs = content || "<w:r><w:t></w:t></w:r>";
    return `<w:p><w:pPr>${style}${jc}${bidi}</w:pPr>${extraPrefix}${runs}</w:p>`;
}
function htmlBlocksToDocx(body) {
    const output = [];
    const visitBlock = (element, listPrefix = "") => {
        const tag = element.tagName.toLowerCase();
        if (tag === "table") {
            const rows = Array.from(element.querySelectorAll(":scope > tbody > tr, :scope > tr"));
            const rowXml = rows.map((row) => {
                const cells = Array.from(row.children).filter((cell) => ["td", "th"].includes(cell.tagName.toLowerCase()));
                const cellXml = cells.map((cell) => {
                    const cellBlocks = Array.from(cell.children).filter((child) => !["script", "style"].includes(child.tagName.toLowerCase()));
                    const paragraphs = cellBlocks.length ? cellBlocks.map((block) => {
                        if (["ul", "ol"].includes(block.tagName.toLowerCase()))
                            return Array.from(block.children).map((li) => paragraphXml(li, Array.from(li.childNodes).map((n) => htmlInlineToRuns(n, {}, containsRtl(li.textContent ?? ""))).join(""), "")).join("");
                        return paragraphXml(block, Array.from(block.childNodes).map((n) => htmlInlineToRuns(n, {}, containsRtl(block.textContent ?? ""))).join(""));
                    }).join("") : "<w:p/>";
                    const width = cell.getAttribute("colspan");
                    const span = width && /^\d+$/.test(width) ? `<w:gridSpan w:val="${Math.min(12, Number(width))}"/>` : "";
                    return `<w:tc><w:tcPr>${span}<w:vAlign w:val="center"/></w:tcPr>${paragraphs}</w:tc>`;
                }).join("");
                return `<w:tr>${cellXml}</w:tr>`;
            }).join("");
            output.push(`<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="CBD5D1"/><w:left w:val="single" w:sz="4" w:color="CBD5D1"/><w:bottom w:val="single" w:sz="4" w:color="CBD5D1"/><w:right w:val="single" w:sz="4" w:color="CBD5D1"/><w:insideH w:val="single" w:sz="4" w:color="CBD5D1"/><w:insideV w:val="single" w:sz="4" w:color="CBD5D1"/></w:tblBorders></w:tblPr>${rowXml}</w:tbl>`);
            return;
        }
        if (tag === "ul" || tag === "ol") {
            const ordered = tag === "ol";
            let index = 1;
            for (const child of Array.from(element.children).filter((item) => item.tagName.toLowerCase() === "li")) {
                const prefix = ordered ? `${index++}. ` : "• ";
                const runs = `<w:r><w:t xml:space="preserve">${xmlEscape(prefix)}</w:t></w:r>` + Array.from(child.childNodes).map((n) => htmlInlineToRuns(n, {}, containsRtl(child.textContent ?? ""))).join("");
                output.push(paragraphXml(child, runs));
            }
            return;
        }
        if (["p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre"].includes(tag)) {
            const runs = Array.from(element.childNodes).map((n) => htmlInlineToRuns(n, {}, containsRtl(element.textContent ?? ""))).join("");
            output.push(paragraphXml(element, runs));
            return;
        }
        if (tag === "br") {
            output.push("<w:p><w:r><w:br/></w:r></w:p>");
            return;
        }
        for (const child of Array.from(element.children))
            visitBlock(child, listPrefix);
    };
    for (const child of Array.from(body.children))
        visitBlock(child);
    return output.join("") || "<w:p><w:r><w:t></w:t></w:r></w:p>";
}
function htmlToDocx(html, title, lang) {
    const parsed = new DOMParser().parseFromString(`<body>${sanitizeWordHtml(html)}</body>`, "text/html");
    const body = parsed.body;
    const bodyXml = htmlBlocksToDocx(body);
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
    const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
    const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`;
    const documentRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>`;
    const safeTitle = title.replace(/[\r\n]+/g, " ").slice(0, 120);
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xmlEscape(safeTitle)}</dc:title><dc:creator>PDF AI Tools</dc:creator></cp:coreProperties>`;
    const types = `${contentTypes.replace("</Types>", '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>')}`;
    return zipSync({
        "[Content_Types].xml": strToU8(types),
        "_rels/.rels": strToU8(rootRels),
        "word/document.xml": strToU8(documentXml),
        "word/_rels/document.xml.rels": strToU8(documentRels),
        "word/styles.xml": strToU8(styles),
        "docProps/core.xml": strToU8(core),
    }, { level: 6 });
}
function safeFileBase(value) {
    const normalized = value.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").trim();
    return (normalized || "document").slice(0, 90);
}
function downloadBytes(bytes, filename, mime) {
    const blob = new Blob([toOwnedArrayBuffer(bytes)], { type: mime });
    void saveBlobToDeviceOrDownload(blob, filename);
}
function openPrintPreview(html, title, lang) {
    const popup = window.open("", "_blank");
    if (!popup)
        return false;
    popup.opener = null;
    const direction = lang === "fa" ? "rtl" : "ltr";
    const safeHtml = sanitizeWordHtml(html);
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="${lang}" dir="${direction}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(title)}</title><style>@page{size:A4;margin:20mm}*{box-sizing:border-box}body{font:12pt/1.8 Arial,Tahoma,sans-serif;color:#17211f;direction:${direction};}h1,h2,h3,h4,h5,h6{line-height:1.35;break-after:avoid}p{margin:0 0 9pt;white-space:pre-wrap}table{width:100%;border-collapse:collapse;margin:10pt 0}td,th{border:1px solid #aab6b1;padding:6pt;vertical-align:top}ul,ol{padding-inline-start:24pt}img{max-width:100%;height:auto}@media print{body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}</style></head><body>${safeHtml}</body></html>`);
    popup.document.close();
    popup.focus();
    window.setTimeout(() => popup.print(), 300);
    return true;
}
export default function WordWorkspace({ t, lang, plan, handoff, onHandoffConsumed, onSendToDocuments, savedItemId, onSavedItemLoaded }) {
    const allPlanLimits = getPlanLimits(plan);
    const { word: planLimits } = allPlanLimits;
    const workspaceLimits = allPlanLimits.workspace;
    const recordId = useRef(createWorkspaceId());
    const hydrating = useRef(false);
    const [localSavedAt, setLocalSavedAt] = useState(0);
    const editorRef = useRef(null);
    const fileInput = useRef(null);
    const [title, setTitle] = useState(() => lang === "fa" ? "سند بدون عنوان" : "Untitled document");
    const [html, setHtml] = useState(() => `<h1>${lang === "fa" ? "سند بدون عنوان" : "Untitled document"}</h1><p><br></p>`);
    const [contentRevision, setContentRevision] = useState(0);
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [pageCount, setPageCount] = useState(1);
    const exceedsPlan = (() => {
        const plain = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
        const payloadBytes = new TextEncoder().encode(JSON.stringify({ title, html })).byteLength;
        return plain.length > planLimits.maxCharacters || payloadBytes > workspaceLimits.maxRecordBytes;
    })();
    useEffect(() => {
        const editor = editorRef.current;
        if (editor) {
            const safeHtml = sanitizeWordHtml(html);
            if (editor.innerHTML !== safeHtml)
                editor.innerHTML = safeHtml;
        }
    }, [contentRevision]);
    useEffect(() => {
        if (!savedItemId)
            return;
        let cancelled = false;
        hydrating.current = true;
        loadWorkspaceItem(savedItemId).then((item) => {
            if (cancelled || !item || item.kind !== "word" || typeof item.payload.html !== "string")
                return;
            recordId.current = item.id;
            setTitle(typeof item.payload.title === "string" ? item.payload.title : item.name);
            setHtml(sanitizeWordHtml(item.payload.html));
            setContentRevision((revision) => revision + 1);
            setDirty(false);
            setLocalSavedAt(item.updatedAt);
            setStatus(lang === "fa" ? "پیش‌نویس محلی بازیابی شد." : "Local draft restored.");
        }).catch(() => setError(lang === "fa" ? "بازیابی پیش‌نویس ناموفق بود." : "Could not restore the local draft."))
            .finally(() => { hydrating.current = false; onSavedItemLoaded?.(); });
        return () => { cancelled = true; };
    }, [savedItemId, planLimits.maxCharacters]);
    useEffect(() => {
        if (!dirty || busy || hydrating.current || exceedsPlan)
            return;
        const timer = window.setTimeout(() => {
            const currentHtml = sanitizeWordHtml(editorRef.current?.innerHTML ?? html);
            void saveWorkspaceItem("word", title, { title, html: currentHtml }, recordId.current)
                .then((item) => { setLocalSavedAt(item.updatedAt); setDirty(false); })
                .catch((error) => setStatus(error instanceof Error && error.message === "workspace_plan_limit" ? (lang === "fa" ? "ظرفیت ذخیره خودکار پلن Free تکمیل شده است. پیش‌نویس‌های قبلی حفظ شده‌اند؛ برای پروژه‌های بیشتر ارتقا دهید یا چند مورد را حذف کنید." : "The Free workspace quota is full. Existing drafts are preserved; upgrade or delete drafts to save more.") : (lang === "fa" ? "ذخیره خودکار ناموفق بود؛ خروجی DOCX بگیرید." : "Autosave failed; please export a DOCX backup.")));
        }, 900);
        return () => window.clearTimeout(timer);
    }, [dirty, title, html, busy, lang, exceedsPlan]);
    useEffect(() => {
        if (!handoff)
            return;
        const text = handoff.text.slice(0, planLimits.maxCharacters);
        const nextHtml = text.split(/\r?\n/).map((line) => `<p>${htmlEscape(line) || "<br>"}</p>`).join("") || "<p><br></p>";
        recordId.current = createWorkspaceId();
        setTitle(handoff.name.replace(/\.[^.]+$/, "").slice(0, 120) || (lang === "fa" ? "سند اسکن‌شده" : "Scanned document"));
        setHtml(nextHtml);
        setContentRevision((revision) => revision + 1);
        setDirty(true);
        setError("");
        setStatus(text.length < handoff.text.length
            ? (lang === "fa" ? "متن وارد شد؛ به‌دلیل محدودیت ویرایشگر، انتهای متن کوتاه شده است." : "Text imported; it was shortened to fit the editor limit.")
            : (lang === "fa" ? "متن با موفقیت از فضای کاری دیگر وارد شد." : "Text imported from another workspace."));
        onHandoffConsumed?.(handoff.id);
    }, [handoff?.id, planLimits.maxCharacters]);
    useEffect(() => {
        const editor = editorRef.current;
        if (!editor)
            return;
        const updatePages = () => { const pageUnit = editor.clientWidth < 600 ? 490 : 1140; setPageCount(Math.max(1, Math.ceil(editor.scrollHeight / pageUnit))); };
        updatePages();
        const observer = new ResizeObserver(updatePages);
        observer.observe(editor);
        editor.addEventListener("input", updatePages);
        return () => { observer.disconnect(); editor.removeEventListener("input", updatePages); };
    }, [contentRevision]);
    const rtl = lang === "fa";
    async function openFile(file) {
        if (!file)
            return;
        if (dirty && !window.confirm(t("wordConfirmReplace"))) {
            if (fileInput.current)
                fileInput.current.value = "";
            return;
        }
        setBusy(true);
        setStatus("");
        setError("");
        try {
            if (file.size > planLimits.maxFileBytes)
                throw new Error("word_file_too_large");
            const extension = file.name.split(".").pop()?.toLowerCase();
            let nextHtml = "";
            if (extension === "docx") {
                const bytes = new Uint8Array(await file.arrayBuffer());
                nextHtml = docxToHtml(bytes, planLimits.maxUncompressedBytes, planLimits.maxCharacters);
            }
            else if (extension === "txt") {
                const text = await file.text();
                if (text.length > planLimits.maxCharacters)
                    throw new Error("word_document_too_large");
                nextHtml = text.split(/\r?\n/).map((line) => `<p>${htmlEscape(line) || "<br>"}</p>`).join("");
            }
            else {
                throw new Error("word_unsupported_file");
            }
            recordId.current = createWorkspaceId();
            setTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 120) || "Document");
            setHtml(nextHtml || "<p><br></p>");
            setContentRevision((revision) => revision + 1);
            setDirty(true);
            setStatus(t("wordOpened"));
        }
        catch (caught) {
            const code = caught instanceof Error ? caught.message : "word_import_failed";
            setError(t(code.startsWith("word_") ? code : "word_import_failed"));
        }
        finally {
            setBusy(false);
            if (fileInput.current)
                fileInput.current.value = "";
        }
    }
    function newDocument() {
        if (dirty && !window.confirm(t("wordConfirmNew")))
            return;
        const fresh = `<h1>${htmlEscape(t("wordNewDocument"))}</h1><p><br></p>`;
        recordId.current = createWorkspaceId();
        setTitle(t("wordNewDocument"));
        setHtml(fresh);
        setContentRevision((revision) => revision + 1);
        setDirty(false);
        setStatus("");
        setError("");
    }
    function runCommand(command, value) {
        editorRef.current?.focus();
        document.execCommand(command, false, value);
        if (editorRef.current) {
            const safeHtml = sanitizeWordHtml(editorRef.current.innerHTML);
            editorRef.current.innerHTML = safeHtml;
            setHtml(safeHtml);
            setDirty(true);
        }
    }
    function insertTable() {
        const cells = Array.from({ length: 3 }, () => `<td><p><br></p></td>`).join("");
        const row = `<tr>${cells}</tr>`;
        const table = `<table><tbody>${row}${row}${row}</tbody></table><p><br></p>`;
        runCommand("insertHTML", table);
    }
    function handleInput() {
        const editor = editorRef.current;
        const rawValue = editor?.innerHTML ?? "";
        const value = sanitizeWordHtml(rawValue);
        if (editor && rawValue !== value)
            editor.innerHTML = value;
        const textLength = editor?.innerText?.length ?? 0;
        if (textLength > planLimits.maxCharacters) {
            if (editor)
                editor.innerHTML = html;
            setError(t("word_document_too_large"));
            return;
        }
        setHtml(value);
        setDirty(true);
        setStatus("");
    }
    function exportDocx() {
        try {
            const current = sanitizeWordHtml(editorRef.current?.innerHTML ?? html);
            const bytes = htmlToDocx(current, title, lang);
            downloadBytes(bytes, `${safeFileBase(title)}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
            setHtml(current);
            setDirty(true);
            setStatus(t("wordExported"));
            setError("");
        }
        catch (caught) {
            const code = caught instanceof Error ? caught.message : "word_export_failed";
            setError(t(code.startsWith("word_") ? code : "word_export_failed"));
        }
    }
    function exportPdf() {
        try {
            const current = sanitizeWordHtml(editorRef.current?.innerHTML ?? html);
            if (!openPrintPreview(current, title, lang)) {
                setError(t("wordPopupBlocked"));
                return;
            }
            setStatus(t("wordPrintHint"));
            setError("");
        }
        catch (caught) {
            const code = caught instanceof Error ? caught.message : "word_export_failed";
            setError(t(code.startsWith("word_") ? code : "word_export_failed"));
        }
    }
    function sendCurrentToAi() {
        const currentText = editorRef.current?.innerText ?? new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
        if (!currentText.trim()) {
            setError(lang === "fa" ? "سند متنی برای ارسال ندارد." : "There is no text to send.");
            return;
        }
        onSendToDocuments?.(`${safeFileBase(title)}.txt`, currentText);
    }
    return (_jsxs("section", { className: "word-page", children: [_jsxs("div", { className: "word-intro", children: [_jsx("div", { className: "word-intro-icon", children: _jsx(Icon, { name: "word", size: 28 }) }), _jsxs("div", { children: [_jsx("h2", { children: t("wordTitle") }), _jsx("p", { className: "muted", children: t("wordIntro") }), _jsx("p", { className: "small muted", children: lang === "fa" ? `پلن ${plan === "pro" ? "Pro" : "Free"}: حداکثر ${Math.round(planLimits.maxFileBytes / 1048576)} مگابایت و ${planLimits.maxCharacters.toLocaleString("fa-IR")} نویسه.` : `${plan === "pro" ? "Pro" : "Free"}: up to ${Math.round(planLimits.maxFileBytes / 1048576)} MB and ${planLimits.maxCharacters.toLocaleString("en-US")} characters.` }), _jsxs("p", { className: "word-privacy", children: [_jsx(Icon, { name: "shield", size: 15 }), t("wordPrivacy")] }), exceedsPlan && _jsxs("div", { className: "plan-over-limit-note", role: "status", children: [_jsx(Icon, { name: "lock", size: 16 }), _jsx("span", { children: lang === "fa" ? "این پیش‌نویس با ظرفیت بالاتر ساخته شده است. محتوای کامل حفظ شده و می‌توانید خروجی بگیرید؛ برای ویرایش و ذخیره تغییرات بیشتر، پلن Pro را فعال کنید." : "This draft was created with higher limits. All content is preserved and can be exported; activate Pro to edit and save larger changes." })] })] })] }), _jsxs("div", { className: "word-filebar", children: [_jsxs("div", { className: "word-file-actions", children: [_jsxs("button", { className: "primary", onClick: () => fileInput.current?.click(), disabled: busy, children: [_jsx(Icon, { name: "upload", size: 16 }), t("wordOpen")] }), _jsxs("button", { onClick: newDocument, disabled: busy, children: [_jsx(Icon, { name: "plus", size: 16 }), t("wordNew")] }), _jsx("input", { ref: fileInput, type: "file", accept: ".docx,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain", hidden: true, onChange: (event) => openFile(event.target.files?.[0]) })] }), _jsxs("label", { className: "word-title-field", children: [_jsx("span", { children: t("wordDocumentName") }), _jsx("input", { value: title, maxLength: 120, readOnly: exceedsPlan, onChange: (event) => { setTitle(event.target.value); setDirty(true); } })] })] }), _jsxs("div", { className: "word-toolbar", role: "toolbar", "aria-label": t("wordToolbar"), children: [_jsx("button", { title: t("wordBold"), "aria-label": t("wordBold"), onMouseDown: (event) => event.preventDefault(), onClick: () => runCommand("bold"), disabled: exceedsPlan, children: _jsx("strong", { children: "B" }) }), _jsx("button", { title: t("wordItalic"), "aria-label": t("wordItalic"), onMouseDown: (event) => event.preventDefault(), onClick: () => runCommand("italic"), disabled: exceedsPlan, children: _jsx("em", { children: "I" }) }), _jsx("button", { title: t("wordUnderline"), "aria-label": t("wordUnderline"), onMouseDown: (event) => event.preventDefault(), onClick: () => runCommand("underline"), disabled: exceedsPlan, children: _jsx("u", { children: "U" }) }), _jsx("span", { className: "word-toolbar-divider" }), _jsx("button", { onMouseDown: (event) => event.preventDefault(), onClick: () => runCommand("formatBlock", "<p>"), disabled: exceedsPlan, children: t("wordParagraph") }), _jsx("button", { onMouseDown: (event) => event.preventDefault(), onClick: () => runCommand("formatBlock", "<h1>"), disabled: exceedsPlan, children: t("wordHeading1") }), _jsx("button", { onMouseDown: (event) => event.preventDefault(), onClick: () => runCommand("formatBlock", "<h2>"), disabled: exceedsPlan, children: t("wordHeading2") }), _jsxs("label", { className: "word-font-size", children: [_jsx("span", { children: t("wordFontSize") }), _jsxs("select", { defaultValue: "3", disabled: exceedsPlan, onMouseDown: (event) => event.stopPropagation(), onChange: (event) => runCommand("fontSize", event.target.value), children: [_jsx("option", { value: "2", children: "10" }), _jsx("option", { value: "3", children: "12" }), _jsx("option", { value: "4", children: "14" }), _jsx("option", { value: "5", children: "18" }), _jsx("option", { value: "6", children: "24" }), _jsx("option", { value: "7", children: "36" })] })] }), _jsx("span", { className: "word-toolbar-divider" }), _jsx("button", { title: t("wordAlignStart"), onMouseDown: (event) => event.preventDefault(), onClick: () => runCommand(rtl ? "justifyRight" : "justifyLeft"), disabled: exceedsPlan, children: t("wordAlignStart") }), _jsx("button", { title: t("wordAlignCenter"), onMouseDown: (event) => event.preventDefault(), onClick: () => runCommand("justifyCenter"), disabled: exceedsPlan, children: t("wordAlignCenter") }), _jsx("button", { title: t("wordAlignEnd"), onMouseDown: (event) => event.preventDefault(), onClick: () => runCommand(rtl ? "justifyLeft" : "justifyRight"), disabled: exceedsPlan, children: t("wordAlignEnd") }), _jsx("span", { className: "word-toolbar-divider" }), _jsx("button", { onMouseDown: (event) => event.preventDefault(), onClick: () => runCommand("insertUnorderedList"), disabled: exceedsPlan, children: t("wordBullets") }), _jsx("button", { onMouseDown: (event) => event.preventDefault(), onClick: () => runCommand("insertOrderedList"), disabled: exceedsPlan, children: t("wordNumbering") }), _jsx("button", { onMouseDown: (event) => event.preventDefault(), onClick: insertTable, disabled: exceedsPlan, children: t("wordInsertTable") }), _jsx("input", { className: "word-color", disabled: exceedsPlan, "aria-label": t("wordTextColor"), type: "color", title: t("wordTextColor"), onChange: (event) => runCommand("foreColor", event.target.value) })] }), _jsxs("div", { className: "word-page-frame", children: [_jsx("div", { className: "word-page-count", "aria-live": "polite", children: t("wordPageCount").replace("{n}", String(pageCount)) }), _jsx("div", { ref: editorRef, className: "word-canvas", contentEditable: !busy && !exceedsPlan, suppressContentEditableWarning: true, spellCheck: true, dir: rtl ? "rtl" : "auto", onInput: handleInput, onPaste: (event) => {
                            const clipboard = event.clipboardData;
                            if (clipboard.files.length) {
                                event.preventDefault();
                                setError(t("wordPasteFilesUnsupported"));
                                return;
                            }
                            // Plain-text paste avoids importing arbitrary external HTML into the editable document.
                            event.preventDefault();
                            document.execCommand("insertText", false, clipboard.getData("text/plain"));
                        } })] }), _jsx("p", { className: "word-page-hint", children: t("wordPageHint") }), _jsxs("div", { className: "word-exportbar", children: [_jsxs("div", { className: "word-export-actions", children: [_jsxs("button", { className: "primary", onClick: exportDocx, disabled: busy, children: [_jsx(Icon, { name: "download", size: 16 }), t("wordDownloadDocx")] }), _jsxs("button", { onClick: exportPdf, disabled: busy, children: [_jsx(Icon, { name: "file-pdf", size: 16 }), t("wordPrintPdf")] }), onSendToDocuments && _jsxs("button", { onClick: sendCurrentToAi, disabled: busy, children: [_jsx(Icon, { name: "brain", size: 16 }), lang === "fa" ? "تحلیل این سند با AI" : "Analyze with AI"] })] }), _jsx("span", { className: "word-save-state", children: dirty ? t("wordUnsaved") : localSavedAt ? (lang === "fa" ? "ذخیره خودکار روی این دستگاه" : "Auto-saved on this device") : t("wordSavedState") })] }), busy && _jsx("p", { className: "word-status", role: "status", children: t("wordLoading") }), status && _jsx("p", { className: "word-status", role: "status", children: status }), error && _jsx("p", { className: "error", role: "alert", children: error }), _jsxs("div", { className: "word-note", children: [_jsx(Icon, { name: "info", size: 17 }), _jsx("p", { children: t("wordLimitations") })] })] }));
}

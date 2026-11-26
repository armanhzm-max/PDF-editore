import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import { pdfjs } from "../core/pdfjs";
import { getPlanLimits } from "../core/entitlements";
import { Icon } from "./icons";
import { toOwnedArrayBuffer } from "../core/bytes";
import { saveBlobToDeviceOrDownload } from "../core/device-folder";
import { hasExpectedFileSignature, resolveAcceptedMime } from "../core/file-signatures.js";
function downloadBlob(blob, filename) {
    void saveBlobToDeviceOrDownload(blob, filename);
}
function SignaturePad({ onSave, onClear, t }) {
    const ref = useRef(null);
    const drawing = useRef(false);
    function point(event) {
        const canvas = ref.current;
        if (!canvas)
            return null;
        const rect = canvas.getBoundingClientRect();
        return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
    }
    function down(event) {
        const canvas = ref.current;
        const ctx = canvas?.getContext("2d");
        const p = point(event);
        if (!canvas || !ctx || !p)
            return;
        drawing.current = true;
        canvas.setPointerCapture(event.pointerId);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#14201e";
    }
    function move(event) {
        if (!drawing.current)
            return;
        const ctx = ref.current?.getContext("2d");
        const p = point(event);
        if (!ctx || !p)
            return;
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
    }
    function up() { drawing.current = false; }
    function clear() {
        const canvas = ref.current;
        canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
        onClear();
    }
    function save() {
        const canvas = ref.current;
        if (!canvas)
            return;
        const ctx = canvas.getContext("2d");
        if (!ctx)
            return;
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        if (!pixels.some((value, index) => index % 4 === 3 && value > 0))
            return;
        onSave(canvas.toDataURL("image/png"));
    }
    return _jsxs("div", { className: "signature-wrap", children: [_jsx("canvas", { ref: ref, className: "signature-canvas", width: 640, height: 180, onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: up }), _jsxs("div", { className: "signature-actions", children: [_jsxs("button", { type: "button", onClick: clear, children: [_jsx(Icon, { name: "trash", size: 15 }), t("editorClear")] }), _jsxs("button", { type: "button", className: "primary", onClick: save, children: [_jsx(Icon, { name: "check", size: 15 }), t("editorUseSignature")] })] })] });
}
export default function PDFEditor({ t, lang, plan }) {
    const { pdfEditor: planLimits } = getPlanLimits(plan);
    const inputRef = useRef(null);
    const sourceBytes = useRef(null);
    const previewCanvas = useRef(null);
    const [filename, setFilename] = useState("");
    const [previewDoc, setPreviewDoc] = useState(null);
    const [pageCount, setPageCount] = useState(0);
    const [pageOrder, setPageOrder] = useState([]);
    const [page, setPage] = useState(1);
    const [selected, setSelected] = useState([]);
    const [rotations, setRotations] = useState({});
    const [annotations, setAnnotations] = useState([]);
    const [noteText, setNoteText] = useState("");
    const [clickPos, setClickPos] = useState({ x: 8, y: 85 });
    const [formFields, setFormFields] = useState([]);
    const [hasAcroForm, setHasAcroForm] = useState(false);
    const [signature, setSignature] = useState(null);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    const [showSignature, setShowSignature] = useState(false);
    const pageLabel = useMemo(() => pageOrder.indexOf(page) + 1, [page, pageOrder]);
    const currentAnnotations = annotations.filter((item) => item.page === page);
    useEffect(() => {
        const loaded = previewDoc;
        return () => { if (loaded)
            void loaded.destroy().catch(() => undefined); };
    }, [previewDoc]);
    useEffect(() => {
        let cancelled = false;
        async function render() {
            if (!previewDoc || !previewCanvas.current || !pageOrder.includes(page))
                return;
            try {
                const pdfPage = await previewDoc.getPage(page);
                const initial = pdfPage.getViewport({ scale: 1.2 });
                const scale = Math.min(1, 920 / initial.width);
                const viewport = pdfPage.getViewport({ scale: 1.2 * scale });
                const canvas = previewCanvas.current;
                if (!canvas || cancelled)
                    return;
                const context = canvas.getContext("2d");
                if (!context)
                    throw new Error("canvas_unavailable");
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                await pdfPage.render({ canvasContext: context, viewport }).promise;
            }
            catch {
                if (!cancelled)
                    setStatus(t("editorPreviewFailed"));
            }
        }
        void render();
        return () => { cancelled = true; };
    }, [previewDoc, page, pageOrder, t]);
    async function loadFile(file) {
        if (!file)
            return;
        setBusy(true);
        setStatus("");
        try {
            const expectedMime = resolveAcceptedMime(file, ["application/pdf"]);
            if (expectedMime !== "application/pdf" || !(await hasExpectedFileSignature(file, expectedMime)))
                throw new Error("invalid_pdf");
            if (file.size > planLimits.maxFileBytes)
                throw new Error("file_too_large");
            const bytes = await file.arrayBuffer();
            const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false }).promise;
            if (pdf.numPages > planLimits.maxPages) {
                await pdf.destroy();
                throw new Error("too_many_pages");
            }
            const pdfForForms = await PDFDocument.load(bytes.slice(0));
            const fields = [];
            let formExists = false;
            try {
                const allFields = pdfForForms.getForm().getFields();
                formExists = allFields.length > 0;
                for (const field of allFields) {
                    const name = field.getName();
                    const kind = field.constructor.name;
                    if (kind.includes("TextField"))
                        fields.push({ name, kind: "text", value: pdfForForms.getForm().getTextField(name).getText() ?? "" });
                    else if (kind.includes("CheckBox"))
                        fields.push({ name, kind: "checkbox", value: pdfForForms.getForm().getCheckBox(name).isChecked() });
                }
            }
            catch { /* Some malformed AcroForm dictionaries cannot be inspected; page editing remains available. */ }
            sourceBytes.current = bytes;
            setPreviewDoc(pdf);
            setFilename(file.name.replace(/\.pdf$/i, ""));
            setPageCount(pdf.numPages);
            setPageOrder(Array.from({ length: pdf.numPages }, (_, index) => index + 1));
            setPage(1);
            setSelected([]);
            setRotations({});
            setAnnotations([]);
            setNoteText("");
            setFormFields(fields);
            setHasAcroForm(formExists);
            setSignature(null);
            setStatus(t("editorLoaded"));
        }
        catch (error) {
            const code = error.message;
            setStatus(code === "file_too_large" ? t("err.file_too_large") : code === "too_many_pages" ? t("err.too_many_pages") : t("editorLoadFailed"));
        }
        finally {
            setBusy(false);
        }
    }
    function toggleSelected(pageNo) {
        setSelected((previous) => previous.includes(pageNo) ? previous.filter((n) => n !== pageNo) : [...previous, pageNo]);
    }
    function movePage(pageNo, delta) {
        setPageOrder((current) => {
            const index = current.indexOf(pageNo);
            const nextIndex = index + delta;
            if (index < 0 || nextIndex < 0 || nextIndex >= current.length)
                return current;
            const copy = [...current];
            [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
            return copy;
        });
    }
    function deletePage(pageNo) {
        if (pageOrder.length <= 1)
            return;
        const next = pageOrder.filter((n) => n !== pageNo);
        setPageOrder(next);
        setSelected((items) => items.filter((n) => n !== pageNo));
        if (page === pageNo)
            setPage(next[Math.min(pageOrder.indexOf(pageNo), next.length - 1)]);
    }
    function rotatePage(pageNo, delta) {
        setRotations((old) => ({ ...old, [pageNo]: ((old[pageNo] ?? 0) + delta + 360) % 360 }));
    }
    function addNote() {
        if (!noteText.trim())
            return;
        setAnnotations((items) => [...items, { page, x: clickPos.x, y: clickPos.y, text: noteText.trim() }]);
        setNoteText("");
    }
    async function saveEditedPdf() {
        if (!sourceBytes.current)
            return;
        setBusy(true);
        setStatus(t("editorSaving"));
        try {
            const doc = await PDFDocument.load(sourceBytes.current.slice(0));
            const form = doc.getForm();
            for (const field of formFields) {
                if (field.kind === "text")
                    form.getTextField(field.name).setText(String(field.value));
                else if (field.value)
                    form.getCheckBox(field.name).check();
                else
                    form.getCheckBox(field.name).uncheck();
            }
            if (hasAcroForm) {
                const formFont = await doc.embedFont(StandardFonts.Helvetica);
                form.updateFieldAppearances(formFont);
                // Flatten before page copying so widget references cannot be orphaned by reordering.
                form.flatten();
            }
            const output = await PDFDocument.create();
            const copiedPages = await output.copyPages(doc, pageOrder.map((number) => number - 1));
            copiedPages.forEach((item, index) => {
                const originalNumber = pageOrder[index];
                const rotation = rotations[originalNumber] ?? 0;
                if (rotation)
                    item.setRotation(degrees((item.getRotation().angle + rotation) % 360));
                output.addPage(item);
            });
            output.setTitle(`${filename || "Document"} - edited`);
            const annotationsByPage = new Map();
            for (const item of annotations) {
                const position = pageOrder.indexOf(item.page);
                if (position < 0)
                    continue;
                annotationsByPage.set(position, [...(annotationsByPage.get(position) ?? []), item]);
            }
            for (const [index, notes] of annotationsByPage) {
                const target = output.getPage(index);
                const width = Math.max(1, Math.ceil(target.getWidth() * 2));
                const height = Math.max(1, Math.ceil(target.getHeight() * 2));
                const overlay = document.createElement("canvas");
                overlay.width = width;
                overlay.height = height;
                const ctx = overlay.getContext("2d");
                if (!ctx)
                    throw new Error("canvas_unavailable");
                for (const note of notes) {
                    const rtl = /[\u0600-\u06FF]/.test(note.text);
                    ctx.direction = rtl ? "rtl" : "ltr";
                    ctx.textAlign = rtl ? "right" : "left";
                    ctx.fillStyle = "#17211f";
                    ctx.font = "30px Tahoma, Arial, sans-serif";
                    const x = (note.x / 100) * width;
                    const y = (note.y / 100) * height;
                    const lines = note.text.split("\n").slice(0, 8);
                    lines.forEach((line, lineIndex) => ctx.fillText(line.slice(0, 160), x, y + lineIndex * 40, width * 0.85));
                }
                const image = await output.embedPng(overlay.toDataURL("image/png"));
                target.drawImage(image, { x: 0, y: 0, width: target.getWidth(), height: target.getHeight() });
                overlay.width = 0;
                overlay.height = 0;
            }
            if (signature) {
                const currentIndex = pageOrder.indexOf(page);
                if (currentIndex >= 0) {
                    const image = await output.embedPng(signature);
                    const target = output.getPage(currentIndex);
                    const maxWidth = Math.min(190, target.getWidth() * 0.35);
                    const dims = image.scale(maxWidth / image.width);
                    target.drawImage(image, { x: 48, y: 35, width: dims.width, height: Math.min(dims.height, 70) });
                }
            }
            const bytes = await output.save();
            downloadBlob(new Blob([toOwnedArrayBuffer(bytes)], { type: "application/pdf" }), `${filename || "document"}-edited.pdf`);
            setStatus(t("editorSaveSuccess"));
        }
        catch (error) {
            console.error(error);
            setStatus(t("editorSaveFailed"));
        }
        finally {
            setBusy(false);
        }
    }
    async function extractSelected() {
        if (!sourceBytes.current || !selected.length)
            return;
        setBusy(true);
        try {
            const source = await PDFDocument.load(sourceBytes.current.slice(0));
            const output = await PDFDocument.create();
            const orderedSelection = pageOrder.filter((n) => selected.includes(n));
            const pages = await output.copyPages(source, orderedSelection.map((n) => n - 1));
            pages.forEach((item) => output.addPage(item));
            const bytes = await output.save();
            downloadBlob(new Blob([toOwnedArrayBuffer(bytes)], { type: "application/pdf" }), `${filename || "document"}-selected-pages.pdf`);
            setStatus(t("editorExtractSuccess"));
        }
        catch {
            setStatus(t("editorSaveFailed"));
        }
        finally {
            setBusy(false);
        }
    }
    function updateField(name, value) {
        setFormFields((fields) => fields.map((field) => field.name === name ? { ...field, value } : field));
    }
    return (_jsxs("section", { className: "pdf-editor-page", children: [_jsxs("div", { className: "editor-heading", children: [_jsxs("div", { children: [_jsx("h2", { children: t("editorTitle") }), _jsx("p", { className: "muted", children: t("editorIntro") }), _jsx("p", { className: "small muted", children: lang === "fa" ? `سقف پلن ${plan === "pro" ? "Pro" : "Free"}: ${planLimits.maxPages} صفحه و ${Math.round(planLimits.maxFileBytes / 1048576)} مگابایت برای هر فایل.` : `${plan === "pro" ? "Pro" : "Free"} limit: ${planLimits.maxPages} pages and ${Math.round(planLimits.maxFileBytes / 1048576)} MB per file.` })] }), _jsxs("button", { className: "primary", type: "button", onClick: () => inputRef.current?.click(), children: [_jsx(Icon, { name: "upload", size: 17 }), t("editorOpenPdf")] }), _jsx("input", { ref: inputRef, type: "file", accept: "application/pdf,.pdf", hidden: true, onChange: (event) => void loadFile(event.target.files?.[0]) })] }), !previewDoc ? _jsxs("div", { className: "editor-empty", onClick: () => inputRef.current?.click(), role: "button", tabIndex: 0, onKeyDown: (event) => { if (event.key === "Enter" || event.key === " ")
                    inputRef.current?.click(); }, children: [_jsx(Icon, { name: "file-pdf", size: 36 }), _jsx("strong", { children: t("editorDropTitle") }), _jsx("span", { className: "muted", children: t("editorDropSub") })] }) : _jsxs(_Fragment, { children: [_jsxs("div", { className: "editor-filebar", children: [_jsxs("span", { children: [_jsx(Icon, { name: "file-pdf", size: 18 }), filename, ".pdf"] }), _jsxs("span", { className: "muted", children: [pageOrder.length, " / ", pageCount, " ", t("editorPages")] })] }), _jsxs("div", { className: "editor-layout", children: [_jsxs("aside", { className: "editor-pages panel", children: [_jsxs("div", { className: "editor-section-title", children: [_jsx("strong", { children: t("editorPagesTitle") }), _jsx("span", { children: pageOrder.length })] }), pageOrder.map((number, index) => _jsxs("div", { className: `editor-page-item ${number === page ? "active" : ""}`, children: [_jsxs("button", { className: "page-select", type: "button", onClick: () => setPage(number), children: [_jsx("span", { className: "page-number", children: index + 1 }), _jsxs("span", { children: [t("editorOriginalPage"), " ", number] })] }), _jsx("input", { "aria-label": `${t("editorSelectPage")} ${number}`, type: "checkbox", checked: selected.includes(number), onChange: () => toggleSelected(number) }), _jsxs("div", { className: "page-controls", children: [_jsx("button", { type: "button", title: t("editorMoveUp"), disabled: index === 0, onClick: () => movePage(number, -1), children: "\u2191" }), _jsx("button", { type: "button", title: t("editorMoveDown"), disabled: index === pageOrder.length - 1, onClick: () => movePage(number, 1), children: "\u2193" }), _jsx("button", { type: "button", title: t("editorRotateLeft"), onClick: () => rotatePage(number, -90), children: "\u21B6" }), _jsx("button", { type: "button", title: t("editorRotateRight"), onClick: () => rotatePage(number, 90), children: "\u21B7" }), _jsx("button", { type: "button", title: t("editorDeletePage"), disabled: pageOrder.length <= 1, onClick: () => deletePage(number), children: _jsx(Icon, { name: "trash", size: 14 }) })] })] }, number)), _jsxs("button", { type: "button", disabled: !selected.length || busy, onClick: () => void extractSelected(), children: [_jsx(Icon, { name: "download", size: 16 }), t("editorExtractSelected"), " (", selected.length, ")"] })] }), _jsxs("div", { className: "editor-main", children: [_jsxs("div", { className: "editor-preview panel", children: [_jsxs("div", { className: "editor-preview-top", children: [_jsx("strong", { children: t("editorPreview") }), _jsxs("span", { className: "muted", children: [t("editorPagePosition"), " ", pageLabel, " / ", pageOrder.length] })] }), _jsxs("div", { className: "pdf-canvas-wrap", onClick: (event) => {
                                                    const rect = event.currentTarget.getBoundingClientRect();
                                                    setClickPos({ x: Math.max(2, Math.min(98, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.max(2, Math.min(98, ((event.clientY - rect.top) / rect.height) * 100)) });
                                                }, children: [_jsx("canvas", { ref: previewCanvas, className: "pdf-preview-canvas" }), currentAnnotations.map((item, index) => _jsx("span", { className: "pdf-note-preview", style: { left: `${item.x}%`, top: `${item.y}%` }, children: item.text }, `${item.page}-${index}`))] }), _jsxs("div", { className: "editor-note-controls", children: [_jsx("input", { value: noteText, maxLength: 500, placeholder: t("editorNotePlaceholder"), onChange: (event) => setNoteText(event.target.value) }), _jsxs("button", { type: "button", disabled: !noteText.trim(), onClick: addNote, children: [_jsx(Icon, { name: "plus", size: 15 }), t("editorAddNote")] })] }), _jsx("p", { className: "muted small", children: t("editorNoteHint") })] }), _jsxs("div", { className: "panel editor-tools-panel", children: [_jsxs("div", { className: "editor-section-title", children: [_jsx("strong", { children: t("editorSignature") }), _jsx("button", { type: "button", className: "link", onClick: () => setShowSignature((open) => !open), children: showSignature ? t("editorHide") : t("editorDrawSignature") })] }), showSignature && _jsx(SignaturePad, { t: t, onSave: (data) => { setSignature(data); setStatus(t("editorSignatureReady")); }, onClear: () => setSignature(null) }), signature && _jsx("p", { className: "small muted", children: t("editorSignatureApplied") })] }), formFields.length > 0 && _jsxs("div", { className: "panel editor-tools-panel", children: [_jsxs("div", { className: "editor-section-title", children: [_jsx("strong", { children: t("editorFillForm") }), _jsx("span", { className: "muted small", children: formFields.length })] }), formFields.map((field) => _jsxs("label", { className: "editor-form-field", children: [_jsx("span", { children: field.name }), field.kind === "text" ? _jsx("input", { value: String(field.value), onChange: (event) => updateField(field.name, event.target.value) })
                                                        : _jsx("input", { type: "checkbox", checked: Boolean(field.value), onChange: (event) => updateField(field.name, event.target.checked) })] }, field.name))] })] })] }), _jsxs("div", { className: "editor-savebar", children: [_jsxs("button", { type: "button", className: "primary", disabled: busy || !pageOrder.length, onClick: () => void saveEditedPdf(), children: [_jsx(Icon, { name: "download", size: 17 }), busy ? t("editorSaving") : t("editorSavePdf")] }), _jsx("span", { className: "muted small", children: t("editorSaveHint") })] })] }), status && _jsx("p", { className: "editor-status", role: "status", children: status }), _jsx("p", { className: "muted small editor-privacy", children: lang === "fa" ? "پردازش این ویرایشگر در مرورگر انجام می‌شود و فایل PDF اصلی به سرور آپلود نمی‌شود." : "This editor processes the PDF in your browser. The original PDF is not uploaded to the server." })] }));
}

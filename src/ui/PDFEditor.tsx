import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { degrees, PDFDocument, StandardFonts } from "pdf-lib";
import { pdfjs } from "../core/pdfjs";
import type { Lang } from "../core/i18n";
import type { Plan } from "../core/types";
import { getPlanLimits } from "../core/entitlements";
import { Icon } from "./icons";
import { toOwnedArrayBuffer } from "../core/bytes";
import { saveBlobToDeviceOrDownload } from "../core/device-folder";
import { hasExpectedFileSignature, resolveAcceptedMime } from "../core/file-signatures.js";

type T = (key: string) => string;
type Annotation = { page: number; x: number; y: number; text: string };
type FormField = { name: string; kind: "text" | "checkbox"; value: string | boolean };
type SignaturePadProps = { onSave: (dataUrl: string) => void; onClear: () => void; t: T };

function downloadBlob(blob: Blob, filename: string) {
  void saveBlobToDeviceOrDownload(blob, filename);
}

function SignaturePad({ onSave, onClear, t }: SignaturePadProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = ref.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * (canvas.width / rect.width), y: (event.clientY - rect.top) * (canvas.height / rect.height) };
  }
  function down(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    const p = point(event);
    if (!canvas || !ctx || !p) return;
    drawing.current = true;
    canvas.setPointerCapture(event.pointerId);
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#14201e";
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = ref.current?.getContext("2d");
    const p = point(event);
    if (!ctx || !p) return;
    ctx.lineTo(p.x, p.y); ctx.stroke();
  }
  function up() { drawing.current = false; }
  function clear() {
    const canvas = ref.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    onClear();
  }
  function save() {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!pixels.some((value, index) => index % 4 === 3 && value > 0)) return;
    onSave(canvas.toDataURL("image/png"));
  }
  return <div className="signature-wrap">
    <canvas ref={ref} className="signature-canvas" width={640} height={180}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
    <div className="signature-actions">
      <button type="button" onClick={clear}><Icon name="trash" size={15} />{t("editorClear")}</button>
      <button type="button" className="primary" onClick={save}><Icon name="check" size={15} />{t("editorUseSignature")}</button>
    </div>
  </div>;
}

export default function PDFEditor({ t, lang, plan }: { t: T; lang: Lang; plan: Plan }) {
  const { pdfEditor: planLimits } = getPlanLimits(plan);
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceBytes = useRef<ArrayBuffer | null>(null);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const [filename, setFilename] = useState("");
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [pageCount, setPageCount] = useState(0);
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<number[]>([]);
  const [rotations, setRotations] = useState<Record<number, number>>({});
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [noteText, setNoteText] = useState("");
  const [clickPos, setClickPos] = useState({ x: 8, y: 85 });
  const [formFields, setFormFields] = useState<FormField[]>([]);
  const [hasAcroForm, setHasAcroForm] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [showSignature, setShowSignature] = useState(false);

  const pageLabel = useMemo(() => pageOrder.indexOf(page) + 1, [page, pageOrder]);
  const currentAnnotations = annotations.filter((item) => item.page === page);

  useEffect(() => {
    const loaded = previewDoc;
    return () => { if (loaded) void loaded.destroy().catch(() => undefined); };
  }, [previewDoc]);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      if (!previewDoc || !previewCanvas.current || !pageOrder.includes(page)) return;
      try {
        const pdfPage = await previewDoc.getPage(page);
        const initial = pdfPage.getViewport({ scale: 1.2 });
        const scale = Math.min(1, 920 / initial.width);
        const viewport = pdfPage.getViewport({ scale: 1.2 * scale });
        const canvas = previewCanvas.current;
        if (!canvas || cancelled) return;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas_unavailable");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        await pdfPage.render({ canvasContext: context, viewport }).promise;
      } catch {
        if (!cancelled) setStatus(t("editorPreviewFailed"));
      }
    }
    void render();
    return () => { cancelled = true; };
  }, [previewDoc, page, pageOrder, t]);

  async function loadFile(file?: File) {
    if (!file) return;
    setBusy(true); setStatus("");
    try {
      const expectedMime = resolveAcceptedMime(file, ["application/pdf"]);
      if (expectedMime !== "application/pdf" || !(await hasExpectedFileSignature(file, expectedMime))) throw new Error("invalid_pdf");
      if (file.size > planLimits.maxFileBytes) throw new Error("file_too_large");
      const bytes = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false }).promise;
      if (pdf.numPages > planLimits.maxPages) { await pdf.destroy(); throw new Error("too_many_pages"); }
      const pdfForForms = await PDFDocument.load(bytes.slice(0));
      const fields: FormField[] = [];
      let formExists = false;
      try {
        const allFields = pdfForForms.getForm().getFields();
        formExists = allFields.length > 0;
        for (const field of allFields) {
          const name = field.getName();
          const kind = field.constructor.name;
          if (kind.includes("TextField")) fields.push({ name, kind: "text", value: pdfForForms.getForm().getTextField(name).getText() ?? "" });
          else if (kind.includes("CheckBox")) fields.push({ name, kind: "checkbox", value: pdfForForms.getForm().getCheckBox(name).isChecked() });
        }
      } catch { /* Some malformed AcroForm dictionaries cannot be inspected; page editing remains available. */ }
      sourceBytes.current = bytes;
      setPreviewDoc(pdf);
      setFilename(file.name.replace(/\.pdf$/i, ""));
      setPageCount(pdf.numPages);
      setPageOrder(Array.from({ length: pdf.numPages }, (_, index) => index + 1));
      setPage(1); setSelected([]); setRotations({}); setAnnotations([]); setNoteText("");
      setFormFields(fields); setHasAcroForm(formExists); setSignature(null); setStatus(t("editorLoaded"));
    } catch (error) {
      const code = (error as Error).message;
      setStatus(code === "file_too_large" ? t("err.file_too_large") : code === "too_many_pages" ? t("err.too_many_pages") : t("editorLoadFailed"));
    } finally { setBusy(false); }
  }

  function toggleSelected(pageNo: number) {
    setSelected((previous) => previous.includes(pageNo) ? previous.filter((n) => n !== pageNo) : [...previous, pageNo]);
  }

  function movePage(pageNo: number, delta: number) {
    setPageOrder((current) => {
      const index = current.indexOf(pageNo);
      const nextIndex = index + delta;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
      return copy;
    });
  }

  function deletePage(pageNo: number) {
    if (pageOrder.length <= 1) return;
    const next = pageOrder.filter((n) => n !== pageNo);
    setPageOrder(next);
    setSelected((items) => items.filter((n) => n !== pageNo));
    if (page === pageNo) setPage(next[Math.min(pageOrder.indexOf(pageNo), next.length - 1)]);
  }

  function rotatePage(pageNo: number, delta: number) {
    setRotations((old) => ({ ...old, [pageNo]: ((old[pageNo] ?? 0) + delta + 360) % 360 }));
  }

  function addNote() {
    if (!noteText.trim()) return;
    setAnnotations((items) => [...items, { page, x: clickPos.x, y: clickPos.y, text: noteText.trim() }]);
    setNoteText("");
  }

  async function saveEditedPdf() {
    if (!sourceBytes.current) return;
    setBusy(true); setStatus(t("editorSaving"));
    try {
      const doc = await PDFDocument.load(sourceBytes.current.slice(0));
      const form = doc.getForm();
      for (const field of formFields) {
        if (field.kind === "text") form.getTextField(field.name).setText(String(field.value));
        else if (field.value) form.getCheckBox(field.name).check();
        else form.getCheckBox(field.name).uncheck();
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
        if (rotation) item.setRotation(degrees((item.getRotation().angle + rotation) % 360));
        output.addPage(item);
      });
      output.setTitle(`${filename || "Document"} - edited`);

      const annotationsByPage = new Map<number, Annotation[]>();
      for (const item of annotations) {
        const position = pageOrder.indexOf(item.page);
        if (position < 0) continue;
        annotationsByPage.set(position, [...(annotationsByPage.get(position) ?? []), item]);
      }
      for (const [index, notes] of annotationsByPage) {
        const target = output.getPage(index);
        const width = Math.max(1, Math.ceil(target.getWidth() * 2));
        const height = Math.max(1, Math.ceil(target.getHeight() * 2));
        const overlay = document.createElement("canvas");
        overlay.width = width; overlay.height = height;
        const ctx = overlay.getContext("2d");
        if (!ctx) throw new Error("canvas_unavailable");
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
        overlay.width = 0; overlay.height = 0;
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
    } catch (error) {
      console.error(error);
      setStatus(t("editorSaveFailed"));
    } finally { setBusy(false); }
  }

  async function extractSelected() {
    if (!sourceBytes.current || !selected.length) return;
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
    } catch { setStatus(t("editorSaveFailed")); }
    finally { setBusy(false); }
  }

  function updateField(name: string, value: string | boolean) {
    setFormFields((fields) => fields.map((field) => field.name === name ? { ...field, value } : field));
  }

  return (
    <section className="pdf-editor-page">
      <div className="editor-heading">
        <div><h2>{t("editorTitle")}</h2><p className="muted">{t("editorIntro")}</p>
        <p className="small muted">{lang === "fa" ? `سقف پلن ${plan === "pro" ? "Pro" : "Free"}: ${planLimits.maxPages} صفحه و ${Math.round(planLimits.maxFileBytes / 1048576)} مگابایت برای هر فایل.` : `${plan === "pro" ? "Pro" : "Free"} limit: ${planLimits.maxPages} pages and ${Math.round(planLimits.maxFileBytes / 1048576)} MB per file.`}</p></div>
        <button className="primary" type="button" onClick={() => inputRef.current?.click()}>
          <Icon name="upload" size={17} />{t("editorOpenPdf")}
        </button>
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void loadFile(event.target.files?.[0])} />
      </div>

      {!previewDoc ? <div className="editor-empty" onClick={() => inputRef.current?.click()} role="button" tabIndex={0}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}>
        <Icon name="file-pdf" size={36} /><strong>{t("editorDropTitle")}</strong><span className="muted">{t("editorDropSub")}</span>
      </div> : <>
        <div className="editor-filebar"><span><Icon name="file-pdf" size={18} />{filename}.pdf</span><span className="muted">{pageOrder.length} / {pageCount} {t("editorPages")}</span></div>
        <div className="editor-layout">
          <aside className="editor-pages panel">
            <div className="editor-section-title"><strong>{t("editorPagesTitle")}</strong><span>{pageOrder.length}</span></div>
            {pageOrder.map((number, index) => <div className={`editor-page-item ${number === page ? "active" : ""}`} key={number}>
              <button className="page-select" type="button" onClick={() => setPage(number)}>
                <span className="page-number">{index + 1}</span><span>{t("editorOriginalPage")} {number}</span>
              </button>
              <input aria-label={`${t("editorSelectPage")} ${number}`} type="checkbox" checked={selected.includes(number)} onChange={() => toggleSelected(number)} />
              <div className="page-controls">
                <button type="button" title={t("editorMoveUp")} disabled={index === 0} onClick={() => movePage(number, -1)}>↑</button>
                <button type="button" title={t("editorMoveDown")} disabled={index === pageOrder.length - 1} onClick={() => movePage(number, 1)}>↓</button>
                <button type="button" title={t("editorRotateLeft")} onClick={() => rotatePage(number, -90)}>↶</button>
                <button type="button" title={t("editorRotateRight")} onClick={() => rotatePage(number, 90)}>↷</button>
                <button type="button" title={t("editorDeletePage")} disabled={pageOrder.length <= 1} onClick={() => deletePage(number)}><Icon name="trash" size={14} /></button>
              </div>
            </div>)}
            <button type="button" disabled={!selected.length || busy} onClick={() => void extractSelected()}>
              <Icon name="download" size={16} />{t("editorExtractSelected")} ({selected.length})
            </button>
          </aside>

          <div className="editor-main">
            <div className="editor-preview panel">
              <div className="editor-preview-top">
                <strong>{t("editorPreview")}</strong>
                <span className="muted">{t("editorPagePosition")} {pageLabel} / {pageOrder.length}</span>
              </div>
              <div className="pdf-canvas-wrap" onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setClickPos({ x: Math.max(2, Math.min(98, ((event.clientX - rect.left) / rect.width) * 100)), y: Math.max(2, Math.min(98, ((event.clientY - rect.top) / rect.height) * 100)) });
              }}>
                <canvas ref={previewCanvas} className="pdf-preview-canvas" />
                {currentAnnotations.map((item, index) => <span className="pdf-note-preview" key={`${item.page}-${index}`} style={{ left: `${item.x}%`, top: `${item.y}%` }}>{item.text}</span>)}
              </div>
              <div className="editor-note-controls">
                <input value={noteText} maxLength={500} placeholder={t("editorNotePlaceholder")} onChange={(event) => setNoteText(event.target.value)} />
                <button type="button" disabled={!noteText.trim()} onClick={addNote}><Icon name="plus" size={15} />{t("editorAddNote")}</button>
              </div>
              <p className="muted small">{t("editorNoteHint")}</p>
            </div>

            <div className="panel editor-tools-panel">
              <div className="editor-section-title"><strong>{t("editorSignature")}</strong>
                <button type="button" className="link" onClick={() => setShowSignature((open) => !open)}>{showSignature ? t("editorHide") : t("editorDrawSignature")}</button>
              </div>
              {showSignature && <SignaturePad t={t} onSave={(data) => { setSignature(data); setStatus(t("editorSignatureReady")); }} onClear={() => setSignature(null)} />}
              {signature && <p className="small muted">{t("editorSignatureApplied")}</p>}
            </div>

            {formFields.length > 0 && <div className="panel editor-tools-panel">
              <div className="editor-section-title"><strong>{t("editorFillForm")}</strong><span className="muted small">{formFields.length}</span></div>
              {formFields.map((field) => <label className="editor-form-field" key={field.name}>
                <span>{field.name}</span>
                {field.kind === "text" ? <input value={String(field.value)} onChange={(event) => updateField(field.name, event.target.value)} />
                  : <input type="checkbox" checked={Boolean(field.value)} onChange={(event) => updateField(field.name, event.target.checked)} />}
              </label>)}
            </div>}
          </div>
        </div>
        <div className="editor-savebar">
          <button type="button" className="primary" disabled={busy || !pageOrder.length} onClick={() => void saveEditedPdf()}>
            <Icon name="download" size={17} />{busy ? t("editorSaving") : t("editorSavePdf")}
          </button>
          <span className="muted small">{t("editorSaveHint")}</span>
        </div>
      </>}
      {status && <p className="editor-status" role="status">{status}</p>}
      <p className="muted small editor-privacy">{lang === "fa" ? "پردازش این ویرایشگر در مرورگر انجام می‌شود و فایل PDF اصلی به سرور آپلود نمی‌شود." : "This editor processes the PDF in your browser. The original PDF is not uploaded to the server."}</p>
    </section>
  );
}

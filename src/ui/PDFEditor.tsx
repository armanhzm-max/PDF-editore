import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
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
type Dims = { w: number; h: number };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const pageRotation = (base: number, delta: number) => (((base ?? 0) + delta) % 360 + 360) % 360;
const isRenderCancel = (error: unknown) => (error as { name?: string } | null)?.name === "RenderingCancelledException";

function downloadBlob(blob: Blob, filename: string) {
  void saveBlobToDeviceOrDownload(blob, filename);
}

// Page dimensions in CSS pixels for the current rotation; cached per (page, rotation).
function usePageDims(doc: any, sourcePage: number, rotation: number): Dims | null {
  const [dims, setDims] = useState<Dims | null>(null);
  useEffect(() => {
    if (!doc) { setDims(null); return; }
    let dead = false;
    doc.getPage(sourcePage)
      .then((pdfPage: any) => {
        if (dead) return;
        const viewport = pdfPage.getViewport({ scale: 1, rotation: pageRotation(pdfPage.rotate, rotation) });
        setDims({ w: viewport.width, h: viewport.height });
      })
      .catch(() => undefined);
    return () => { dead = true; };
  }, [doc, sourcePage, rotation]);
  return dims;
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

// One page sheet inside the scrolling reading stage. Renders lazily near the viewport
// and releases its bitmap ("parks") when far away so large documents stay memory-light.
function PdfSheet({
  doc, sourcePage, scale, rotation, active, annotations, stageEl,
  registerNode, onPlaceNote, onRenderError,
}: {
  doc: any;
  sourcePage: number;
  scale: number;
  rotation: number;
  active: boolean;
  annotations: Annotation[];
  stageEl: HTMLDivElement | null;
  registerNode: (sourcePage: number, node: HTMLDivElement | null) => void;
  onPlaceNote: (event: React.MouseEvent<HTMLDivElement>, sourcePage: number) => void;
  onRenderError: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<{ cancel: () => void } | null>(null);
  const errorRef = useRef(onRenderError);
  errorRef.current = onRenderError;
  const dims = usePageDims(doc, sourcePage, rotation);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = wrapRef.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => setInView(entries.some((entry) => entry.isIntersecting)),
      { root: stageEl, rootMargin: "700px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [stageEl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!inView || !dims || scale <= 0) {
      if (canvas.width > 0) { canvas.width = 0; canvas.height = 0; }
      return;
    }
    let dead = false;
    (async () => {
      try {
        const pdfPage = await doc.getPage(sourcePage);
        const viewport = pdfPage.getViewport({ scale, rotation: pageRotation(pdfPage.rotate, rotation) });
        if (dead) return;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("canvas_unavailable");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        try { taskRef.current?.cancel(); } catch { /* previous task already settled */ }
        const task = pdfPage.render({ canvasContext: context, viewport });
        taskRef.current = task;
        await task.promise;
      } catch (error) {
        if (!dead && !isRenderCancel(error)) errorRef.current();
      }
    })();
    return () => { dead = true; try { taskRef.current?.cancel(); } catch { /* already settled */ } };
  }, [doc, sourcePage, rotation, scale, dims, inView]);

  return (
    <div
      ref={(node) => { wrapRef.current = node; registerNode(sourcePage, node); }}
      className={`pdfw-sheet ${active ? "is-active" : ""}`}
      style={dims ? { width: Math.round(dims.w * scale), height: Math.round(dims.h * scale) } : undefined}
      onClick={(event) => onPlaceNote(event, sourcePage)}
    >
      <canvas ref={canvasRef} className="pdfw-canvas" />
      {annotations.map((item, index) => (
        <span className="pdf-note-preview" key={`${item.page}-${index}`} style={{ left: `${item.x}%`, top: `${item.y}%` }}>{item.text}</span>
      ))}
    </div>
  );
}

// Sidebar thumbnail: small lazy render with the same page-management actions as before.
function PageThumb({
  doc, sourcePage, displayIndex, rotation, active, selected, thumbsEl, isFirst, isLast, isOnly,
  onOpen, onToggleSelect, onMove, onRotate, onDelete, t,
}: {
  doc: any;
  sourcePage: number;
  displayIndex: number;
  rotation: number;
  active: boolean;
  selected: boolean;
  thumbsEl: HTMLDivElement | null;
  isFirst: boolean;
  isLast: boolean;
  isOnly: boolean;
  onOpen: (sourcePage: number) => void;
  onToggleSelect: (sourcePage: number) => void;
  onMove: (sourcePage: number, delta: number) => void;
  onRotate: (sourcePage: number, delta: number) => void;
  onDelete: (sourcePage: number) => void;
  t: T;
}) {
  const viewRef = useRef<HTMLButtonElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const taskRef = useRef<{ cancel: () => void } | null>(null);
  const dims = usePageDims(doc, sourcePage, rotation);
  const [inView, setInView] = useState(false);
  const thumbWidth = 108;
  const thumbScale = dims ? thumbWidth / dims.w : 0;

  useEffect(() => {
    const element = viewRef.current;
    if (!element) return;
    const observer = new IntersectionObserver((entries) => setInView(entries.some((entry) => entry.isIntersecting)),
      { root: thumbsEl, rootMargin: "300px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [thumbsEl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!inView || !dims || thumbScale <= 0) {
      if (canvas.width > 0) { canvas.width = 0; canvas.height = 0; }
      return;
    }
    let dead = false;
    (async () => {
      try {
        const pdfPage = await doc.getPage(sourcePage);
        const viewport = pdfPage.getViewport({ scale: thumbScale, rotation: pageRotation(pdfPage.rotate, rotation) });
        if (dead) return;
        const context = canvas.getContext("2d");
        if (!context) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        try { taskRef.current?.cancel(); } catch { /* previous task already settled */ }
        const task = pdfPage.render({ canvasContext: context, viewport });
        taskRef.current = task;
        await task.promise;
      } catch { /* cancelled or parked */ }
    })();
    return () => { dead = true; try { taskRef.current?.cancel(); } catch { /* already settled */ } };
  }, [doc, sourcePage, rotation, thumbScale, dims, inView]);

  return (
    <div className={`pdfw-thumb ${active ? "is-active" : ""}`}>
      <button ref={viewRef} type="button" className="pdfw-thumb-view" onClick={() => onOpen(sourcePage)}
        aria-label={`${t("editorPageInput")}: ${displayIndex}`} aria-current={active ? "true" : undefined}
        style={dims ? { width: thumbWidth, height: Math.max(1, Math.round(dims.h * thumbScale)) } : { width: thumbWidth, height: 140 }}>
        <canvas ref={canvasRef} className="pdfw-canvas" />
      </button>
      <span className="pdfw-thumb-no">{displayIndex}</span>
      <label className="pdfw-thumb-check" onClick={(event) => event.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={() => onToggleSelect(sourcePage)}
          aria-label={`${t("editorSelectPage")} ${displayIndex}`} />
      </label>
      <div className="pdfw-thumb-ops">
        <button type="button" title={t("editorMoveUp")} aria-label={t("editorMoveUp")} disabled={isFirst} onClick={() => onMove(sourcePage, -1)}>↑</button>
        <button type="button" title={t("editorMoveDown")} aria-label={t("editorMoveDown")} disabled={isLast} onClick={() => onMove(sourcePage, 1)}>↓</button>
        <button type="button" title={t("editorRotateLeft")} aria-label={t("editorRotateLeft")} onClick={() => onRotate(sourcePage, -90)}>↶</button>
        <button type="button" title={t("editorRotateRight")} aria-label={t("editorRotateRight")} onClick={() => onRotate(sourcePage, 90)}>↷</button>
        <button type="button" title={t("editorDeletePage")} aria-label={t("editorDeletePage")} disabled={isOnly} onClick={() => onDelete(sourcePage)}><Icon name="trash" size={13} /></button>
      </div>
    </div>
  );
}

export default function PDFEditor({ t, lang, plan }: { t: T; lang: Lang; plan: Plan }) {
  const { pdfEditor: planLimits } = getPlanLimits(plan);
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceBytes = useRef<ArrayBuffer | null>(null);
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

  // Reader view state: fit-width by default, uniform zoom otherwise.
  const [fitMode, setFitMode] = useState<"width" | "page" | null>("width");
  const [zoom, setZoom] = useState(100);
  const [stageEl, setStageEl] = useState<HTMLDivElement | null>(null);
  const [thumbsEl, setThumbsEl] = useState<HTMLDivElement | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [pageText, setPageText] = useState("1");

  const sheetNodes = useRef(new Map<number, HTMLDivElement>());
  const scrollLock = useRef(0);

  const pageLabel = useMemo(() => pageOrder.indexOf(page) + 1, [page, pageOrder]);
  const displayIndexByPage = useMemo(() => new Map(pageOrder.map((number, index) => [number, index + 1])), [pageOrder]);
  const currentAnnotations = useMemo(() => annotations.filter((item) => item.page === page), [annotations, page]);
  const activeRotation = rotations[page] ?? 0;
  const activeDims = usePageDims(previewDoc, page, activeRotation);

  useEffect(() => {
    const loaded = previewDoc;
    return () => { if (loaded) void loaded.destroy().catch(() => undefined); };
  }, [previewDoc]);

  // Track the stage box so fit modes follow resizes.
  useEffect(() => {
    if (!stageEl) return;
    const measure = () => setStageSize({ w: stageEl.clientWidth, h: stageEl.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stageEl);
    return () => observer.disconnect();
  }, [stageEl]);

  // Fit-width / fit-page derive their scale from the active page and stage size.
  // clientWidth/clientHeight include the stage padding, so subtract it plus breathing room.
  const stageGutterX = 32 + 24;
  const stageGutterY = 50 + 24;
  const fitScale = activeDims && stageSize.w > 0
    ? fitMode === "width" ? (stageSize.w - stageGutterX) / activeDims.w
      : fitMode === "page" ? Math.min((stageSize.w - stageGutterX) / activeDims.w, (stageSize.h - stageGutterY) / activeDims.h)
        : null
    : null;
  const scale = fitScale ?? zoom / 100;
  const zoomPercent = Math.round(scale * 100);

  // Scroll spy: the page nearest the stage middle becomes the active page.
  useEffect(() => {
    if (!stageEl) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (Date.now() < scrollLock.current) return;
      const stageRect = stageEl.getBoundingClientRect();
      const middle = stageRect.top + stageRect.height / 2;
      let best = -1;
      let bestDistance = Infinity;
      sheetNodes.current.forEach((node, sourcePage) => {
        const rect = node.getBoundingClientRect();
        if (rect.height === 0) return;
        const distance = Math.abs(rect.top + rect.height / 2 - middle);
        if (distance < bestDistance) { bestDistance = distance; best = sourcePage; }
      });
      if (best > 0) setPage((current) => (current === best ? current : best));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    stageEl.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => { stageEl.removeEventListener("scroll", onScroll); if (frame) cancelAnimationFrame(frame); };
  }, [stageEl, pageOrder]);

  // Keep the thumbnail sidebar following the active page.
  useEffect(() => {
    const list = thumbsEl;
    if (!list) return;
    const active = list.querySelector(".pdfw-thumb.is-active") as HTMLElement | null;
    if (!active) return;
    const top = active.offsetTop;
    const bottom = top + active.offsetHeight;
    if (top < list.scrollTop) list.scrollTo({ top: Math.max(0, top - 8), behavior: "smooth" });
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTo({ top: bottom - list.clientHeight + 8, behavior: "smooth" });
  }, [page, thumbsEl, pageOrder]);

  // Page input mirrors the active position.
  useEffect(() => { setPageText(String(pageLabel)); }, [pageLabel]);

  const registerSheet = useCallback((sourcePage: number, node: HTMLDivElement | null) => {
    if (node) sheetNodes.current.set(sourcePage, node);
    else sheetNodes.current.delete(sourcePage);
  }, []);

  function scrollToPage(sourcePage: number) {
    setPage(sourcePage);
    const node = sheetNodes.current.get(sourcePage);
    if (stageEl && node) {
      scrollLock.current = Date.now() + 700;
      stageEl.scrollTo({ top: Math.max(0, node.offsetTop - 16), behavior: "smooth" });
    }
  }

  function stepPage(delta: number) {
    if (!pageOrder.length) return;
    const position = clamp(pageOrder.indexOf(page) + delta, 0, pageOrder.length - 1);
    scrollToPage(pageOrder[position]);
  }

  function zoomBy(delta: number) {
    // Step from the effective zoom (fit modes count), then hand control to manual zoom.
    const base = fitMode ? zoomPercent : zoom;
    setFitMode(null);
    setZoom(clamp(Math.round((base + delta) / 5) * 5, 25, 400));
  }

  function commitPageText() {
    const position = Number.parseInt(pageText, 10);
    const source = Number.isFinite(position) ? pageOrder[clamp(position - 1, 0, pageOrder.length - 1)] : undefined;
    if (source && source !== page) scrollToPage(source);
    setPageText(String(pageOrder.indexOf(page) + 1));
  }

  // Global reader shortcuts while a document is open (PageUp/PageDown, +/-).
  useEffect(() => {
    if (!previewDoc) return;
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector(".auth-overlay")) return;
      const target = event.target as HTMLElement | null;
      if (target && target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "PageDown") { event.preventDefault(); stepPage(1); }
      else if (event.key === "PageUp") { event.preventDefault(); stepPage(-1); }
      else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomBy(10); }
      else if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomBy(-10); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // stepPage/zoomBy read live state through this effect's closure re-runs.
  }, [previewDoc, page, pageOrder]);

  function placeNoteAt(event: React.MouseEvent<HTMLDivElement>, sourcePage: number) {
    const rect = event.currentTarget.getBoundingClientRect();
    setClickPos({
      x: Math.max(2, Math.min(98, ((event.clientX - rect.left) / rect.width) * 100)),
      y: Math.max(2, Math.min(98, ((event.clientY - rect.top) / rect.height) * 100)),
    });
    if (sourcePage !== page) setPage(sourcePage);
  }

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
      setFormFields(fields); setHasAcroForm(formExists); setSignature(null);
      setFitMode("width"); setZoom(100);
      sheetNodes.current.clear();
      setStatus(t("editorLoaded"));
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
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" hidden onChange={(event) => void loadFile(event.target.files?.[0])} />

      {!previewDoc ? <>
        <div className="editor-heading">
          <div><h2>{t("editorTitle")}</h2><p className="muted">{t("editorIntro")}</p>
          <p className="small muted">{lang === "fa" ? `سقف پلن ${plan === "pro" ? "Pro" : "Free"}: ${planLimits.maxPages} صفحه و ${Math.round(planLimits.maxFileBytes / 1048576)} مگابایت برای هر فایل.` : `${plan === "pro" ? "Pro" : "Free"} limit: ${planLimits.maxPages} pages and ${Math.round(planLimits.maxFileBytes / 1048576)} MB per file.`}</p></div>
          <button className="primary" type="button" onClick={() => inputRef.current?.click()}>
            <Icon name="upload" size={17} />{t("editorOpenPdf")}
          </button>
        </div>
        <div className="editor-empty" onClick={() => inputRef.current?.click()} role="button" tabIndex={0}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}>
          <Icon name="file-pdf" size={36} /><strong>{t("editorDropTitle")}</strong><span className="muted">{t("editorDropSub")}</span>
        </div>
      </> : (
        <div className="pdfw">
          <div className="pdfw-toolbar" role="toolbar" aria-label={t("editorTitle")}>
            <button type="button" onClick={() => inputRef.current?.click()} title={t("editorOpenPdf")}>
              <Icon name="upload" size={16} /><span className="tb-label">{t("editorOpenPdf")}</span>
            </button>
            <span className="tb-divider" aria-hidden="true" />
            <span className="tb-file" title={`${filename}.pdf`}><Icon name="file-pdf" size={16} /><span>{filename}.pdf</span></span>
            <span className="tb-divider" aria-hidden="true" />
            <div className="tb-cluster">
              <button type="button" aria-label={t("editorPrevPage")} title={t("editorPrevPage")} disabled={pageLabel <= 1} onClick={() => stepPage(-1)}>
                <Icon name="chevron-left" size={16} />
              </button>
              <input className="pdfw-page-input" dir="ltr" inputMode="numeric" value={pageText} aria-label={t("editorPageInput")} disabled={busy}
                onChange={(event) => setPageText(event.target.value.replace(/[^\d]/g, "").slice(0, 4))}
                onKeyDown={(event) => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                onBlur={commitPageText} />
              <span className="pdfw-page-total">/ {pageOrder.length}</span>
              <button type="button" aria-label={t("editorNextPage")} title={t("editorNextPage")} disabled={pageLabel >= pageOrder.length} onClick={() => stepPage(1)}>
                <Icon name="chevron-right" size={16} />
              </button>
            </div>
            <span className="tb-divider" aria-hidden="true" />
            <div className="tb-cluster">
              <button type="button" aria-label={t("zoomOut")} title={t("zoomOut")} onClick={() => zoomBy(-10)}>−</button>
              <button type="button" className="pdfw-zoom-pct" title={t("zoomLevel")} onClick={() => { setFitMode(null); setZoom(100); }}>{zoomPercent}%</button>
              <button type="button" aria-label={t("zoomIn")} title={t("zoomIn")} onClick={() => zoomBy(10)}>+</button>
              <button type="button" aria-label={t("zoomFitWidth")} title={t("zoomFitWidth")} className={fitMode === "width" ? "active" : ""} onClick={() => setFitMode("width")}>
                <Icon name="fit-width" size={16} />
              </button>
              <button type="button" aria-label={t("zoomFitPage")} title={t("zoomFitPage")} className={fitMode === "page" ? "active" : ""} onClick={() => setFitMode("page")}>
                <Icon name="fit-page" size={16} />
              </button>
            </div>
            <span className="tb-spacer" />
            <div className="tb-cluster">
              <button type="button" aria-label={t("editorRotateLeft")} title={t("editorRotateLeft")} onClick={() => rotatePage(page, -90)}>↶</button>
              <button type="button" aria-label={t("editorRotateRight")} title={t("editorRotateRight")} onClick={() => rotatePage(page, 90)}>↷</button>
              <button type="button" disabled={busy || !selected.length} onClick={() => void extractSelected()} title={t("editorExtractSelected")}>
                <Icon name="download" size={15} /><span className="tb-label">{t("editorExtractSelected")}{selected.length ? ` (${selected.length})` : ""}</span>
              </button>
              <button type="button" className="primary" disabled={busy || !pageOrder.length} onClick={() => void saveEditedPdf()} title={t("editorSavePdf")}>
                <Icon name="download" size={16} /><span className="tb-label">{busy ? t("editorSaving") : t("editorSavePdf")}</span>
              </button>
            </div>
          </div>

          <div className="pdfw-body">
            <aside className="pdfw-thumbs">
              <div className="pdfw-panel-head"><strong>{t("editorThumbnails")}</strong><span>{pageOrder.length}</span></div>
              <div className="pdfw-thumb-list" ref={setThumbsEl}>
                {pageOrder.map((number, index) => (
                  <PageThumb key={number} doc={previewDoc} sourcePage={number} displayIndex={index + 1}
                    rotation={rotations[number] ?? 0} active={number === page} selected={selected.includes(number)} thumbsEl={thumbsEl}
                    isFirst={index === 0} isLast={index === pageOrder.length - 1} isOnly={pageOrder.length <= 1}
                    onOpen={scrollToPage} onToggleSelect={toggleSelected} onMove={movePage} onRotate={rotatePage} onDelete={deletePage} t={t} />
                ))}
              </div>
            </aside>

            <div className="pdfw-stage" ref={setStageEl}>
              {pageOrder.map((number) => (
                <PdfSheet key={number} doc={previewDoc} sourcePage={number} scale={scale}
                  rotation={rotations[number] ?? 0} active={number === page}
                  annotations={annotations.filter((item) => item.page === number)}
                  stageEl={stageEl} registerNode={registerSheet} onPlaceNote={placeNoteAt}
                  onRenderError={() => setStatus((current) => current || t("editorPreviewFailed"))} />
              ))}
            </div>

            <aside className="pdfw-tools">
              <details className="pdfw-tool" open>
                <summary><Icon name="message" size={15} />{t("editorNotes")}</summary>
                <div className="pdfw-tool-body">
                  <p className="small muted">{t("editorNoteHint")}</p>
                  <div className="editor-note-controls">
                    <input value={noteText} maxLength={500} placeholder={t("editorNotePlaceholder")} onChange={(event) => setNoteText(event.target.value)} />
                    <button type="button" disabled={!noteText.trim()} onClick={addNote}><Icon name="plus" size={15} />{t("editorAddNote")}</button>
                  </div>
                  {currentAnnotations.length > 0 && (
                    <ul className="pdfw-note-list">
                      {currentAnnotations.map((item, index) => (
                        <li key={`${item.page}-${index}`}>
                          <span>{item.text}</span>
                          <button type="button" aria-label={t("close")} title={t("close")}
                            onClick={() => setAnnotations((items) => items.filter((entry) => entry !== item))}>×</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </details>

              <details className="pdfw-tool" open>
                <summary><Icon name="lock" size={15} />{t("editorSignature")}</summary>
                <div className="pdfw-tool-body">
                  <div className="editor-section-title">
                    <button type="button" className="link" onClick={() => setShowSignature((open) => !open)}>
                      {showSignature ? t("editorHide") : t("editorDrawSignature")}
                    </button>
                  </div>
                  {showSignature && <SignaturePad t={t} onSave={(data) => { setSignature(data); setStatus(t("editorSignatureReady")); }} onClear={() => setSignature(null)} />}
                  {signature && <p className="small muted">{t("editorSignatureApplied")}</p>}
                </div>
              </details>

              {formFields.length > 0 && (
                <details className="pdfw-tool" open>
                  <summary><Icon name="file-text" size={15} />{t("editorFillForm")}<span className="muted small">{formFields.length}</span></summary>
                  <div className="pdfw-tool-body">
                    {formFields.map((field) => <label className="editor-form-field" key={field.name}>
                      <span>{field.name}</span>
                      {field.kind === "text" ? <input value={String(field.value)} onChange={(event) => updateField(field.name, event.target.value)} />
                        : <input type="checkbox" checked={Boolean(field.value)} onChange={(event) => updateField(field.name, event.target.checked)} />}
                    </label>)}
                  </div>
                </details>
              )}
            </aside>
          </div>

          <div className="pdfw-status">
            <span className="pdfw-status-page"><strong>{pageLabel}</strong> / {pageOrder.length}</span>
            <span className="muted pdfw-status-file">{filename}.pdf</span>
            {selected.length > 0 && <span className="pdfw-badge">{selected.length} {t("editorSelectedCount")}</span>}
            <span className="tb-spacer" />
            <span className="muted small pdfw-hint">{t("editorSaveHint")}</span>
            <input type="range" className="pdfw-slider" min={25} max={400} step={5} value={clamp(zoomPercent, 25, 400)}
              aria-label={t("zoomLevel")} onChange={(event) => { setFitMode(null); setZoom(Number(event.target.value)); }} />
            <button type="button" className="pdfw-zoom-pct" title={t("zoomLevel")} onClick={() => { setFitMode(null); setZoom(100); }}>{zoomPercent}%</button>
            <span className="pdfw-plan-chip">{plan === "pro" ? "Pro" : "Free"} · {planLimits.maxPages}p</span>
          </div>
        </div>
      )}

      {status && <p className="editor-status" role="status">{status}</p>}
      <p className="muted small editor-privacy">{lang === "fa" ? "پردازش این ویرایشگر در مرورگر انجام می‌شود و فایل PDF اصلی به سرور آپلود نمی‌شود." : "This editor processes the PDF in your browser. The original PDF is not uploaded to the server."}</p>
    </section>
  );
}

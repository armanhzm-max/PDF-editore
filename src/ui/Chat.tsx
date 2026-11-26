import { useMemo, useRef, useState } from "react";
import { runAgent, uniqueName, type Msg } from "../core/agent";
import { callAssistant } from "../core/ai";
import { extractDocument, type ExtractedDocument } from "../core/document-extract";
import { getPlanLimits } from "../core/entitlements";
import { download } from "../core/file-access";
import type { Plan } from "../core/types";
import type { Me } from "../core/permissions";
import { getTool } from "../core/registry";
import { Icon, toolIcon } from "./icons";

type T = (key: string) => string;
type Task = "ask" | "summarize" | "compare" | "extract" | "slides";
type ChatSource = ExtractedDocument & { id: string; bytes: number; selected: boolean };
const ACCEPT = ".pdf,.docx,.xlsx,.pptx,.txt,.csv,.tsv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv";
const sizeLabel = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function taskInstruction(task: Task, lang: "fa" | "en"): string {
  const instructions: Record<Task, { fa: string; en: string }> = {
    ask: { fa: "به پرسش کاربر بر اساس اسناد انتخاب‌شده پاسخ بده.", en: "Answer the user's question using the selected documents." },
    summarize: { fa: "اسناد انتخاب‌شده را به‌صورت ساختاریافته خلاصه کن و نکات، اعداد و اقدامات مهم را بیاور.", en: "Summarize the selected documents in a structured way, including important points, figures and action items." },
    compare: { fa: "اسناد انتخاب‌شده را مقایسه کن و تفاوت‌ها و موارد مشترک را با ارجاع منبع نشان بده.", en: "Compare the selected documents and show agreements and differences with source references." },
    extract: { fa: "اطلاعات مهم و فیلدهای ساختاریافته را استخراج کن؛ اطلاعات ناموجود را حدس نزن.", en: "Extract important facts and structured fields; do not guess missing information." },
    slides: { fa: "از اسناد انتخاب‌شده طرح ارائه پاورپوینت بساز و برای هر اسلاید منبع را مشخص کن.", en: "Create a PowerPoint outline from the selected documents and cite the source for each slide." },
  };
  return instructions[task][lang];
}

export default function Chat({ t, lang, plan, loggedIn, askLogin, aiEnabled, agentEnabled, usage }: {
  t: T; lang: "fa" | "en"; plan: Plan; loggedIn: boolean; askLogin: () => void;
  aiEnabled: boolean; agentEnabled: boolean; usage?: Me["usage"];
}) {
  const ws = useRef(new Map<string, File>());
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [sources, setSources] = useState<ChatSource[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [task, setTask] = useState<Task>("ask");
  const [toolMode, setToolMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const limits = getPlanLimits(plan).documents;
  const totalBytes = useMemo(() => sources.reduce((sum, source) => sum + source.bytes, 0), [sources]);
  const selectedSources = useMemo(() => sources.filter((source) => source.selected), [sources]);
  const context = useMemo(() => {
    let remaining = limits.maxContextChars;
    const chunks: string[] = [];
    for (const source of selectedSources) {
      if (remaining <= 0) break;
      const header = `\n\n===== SOURCE: ${source.name} (${source.format}) =====\n`;
      const content = source.text.slice(0, Math.max(0, remaining - header.length - 48));
      const suffix = source.truncated || content.length < source.text.length ? "\n[Source excerpt truncated locally]" : "";
      chunks.push(`${header}${content}${suffix}\n===== END SOURCE =====`);
      remaining -= header.length + content.length + suffix.length;
    }
    return chunks.join("");
  }, [selectedSources, limits.maxContextChars]);

  async function addFiles(fileList: FileList | File[]) {
    setBusy(true); setError(""); setNotice(t("assistantExtracting"));
    try {
      const incoming = Array.from(fileList);
      if (!incoming.length) return;
      if (sources.length + incoming.length > limits.maxFiles) throw new Error("document_file_count");
      if (incoming.some((file) => file.size > limits.maxFileBytes)) throw new Error("document_file_large");
      if (totalBytes + incoming.reduce((sum, file) => sum + file.size, 0) > limits.maxTotalBytes) throw new Error("document_total_large");
      const prepared: ChatSource[] = [];
      for (const file of incoming) {
        const extracted = await extractDocument(file, { maxFileBytes: limits.maxFileBytes, maxUncompressedBytes: limits.maxUncompressedBytes, maxPdfPages: limits.maxPdfPages });
        const name = uniqueName(file.name, ws.current);
        ws.current.set(name, file);
        prepared.push({ ...extracted, name, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, bytes: file.size, selected: true });
      }
      setSources((current) => [...current, ...prepared]);
      setNotice(lang === "fa" ? "متن اسناد در مرورگر استخراج شد؛ هیچ فایلی بارگذاری نشد." : "Document text was extracted locally; no file was uploaded.");
    } catch (caught) {
      const key = (caught as Error).message;
      setError(t(`docError.${key}`) || t("assistantPrepareFailed"));
      setNotice("");
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function removeSource(source: ChatSource) {
    ws.current.delete(source.name);
    setSources((current) => current.filter((item) => item.id !== source.id));
  }

  async function send() {
    const prompt = input.trim();
    if ((!prompt && !selectedSources.length) || busy) return;
    if (!aiEnabled) { setError(t("aiConnectionPending")); return; }
    if (!loggedIn) { askLogin(); return; }
    if (task === "compare" && selectedSources.length < 2) {
      setError(lang === "fa" ? "برای مقایسه حداقل دو سند انتخاب کنید." : "Select at least two documents to compare.");
      return;
    }
    if (toolMode && !agentEnabled) { setError(t("assistantAgentUnavailable")); return; }
    const userText = `${taskInstruction(task, lang)}${prompt ? `\n\n${prompt}` : ""}`;
    const next: Msg[] = [...messages, { role: "user", content: userText }];
    setMessages(next); setInput(""); setBusy(true); setError(""); setNotice("");
    try {
      if (toolMode) {
        const selectedWorkspace = new Map<string, File>();
        for (const source of selectedSources) {
          const file = ws.current.get(source.name);
          if (file) selectedWorkspace.set(source.name, file);
        }
        const result = await runAgent(next, selectedWorkspace, plan, setMessages);
        setMessages(result);
      } else {
        const history = messages.filter((message): message is { role: "user" | "assistant"; content: string } => typeof message.content === "string").slice(-28);
        const result = await callAssistant([...history, { role: "user", content: userText }], context);
        setMessages([...next, { role: "assistant", content: result }]);
      }
    } catch (caught) {
      const code = (caught as Error).message;
      setError(t(`err.${code}`) === `err.${code}` ? (code === "ai_disabled" || code === "agent_disabled" ? t("aiConnectionPending") : t("assistantRequestFailed")) : t(`err.${code}`));
    } finally { setBusy(false); }
  }

  const usageLine = usage
    ? (lang === "fa" ? `گفت‌وگو: ${usage.agentUsed ?? 0} از ${usage.agentLimit ?? (plan === "pro" ? 300 : 10)} درخواست امروز` : `Assistant: ${usage.agentUsed ?? 0} of ${usage.agentLimit ?? (plan === "pro" ? 300 : 10)} requests today`)
    : (lang === "fa" ? `پلن ${plan === "pro" ? "Pro" : "Free"}` : `${plan === "pro" ? "Pro" : "Free"} plan`);

  return (
    <main className="assistant assistant-pro">
      <aside className="bay assistant-sidebar">
        <div className="assistant-side-title"><span className="assistant-symbol"><Icon name="brain" size={20}/></span><div><h2>{t("assistantTitle")}</h2><small>{t("assistantWorkspaceIntro")}</small></div></div>
        <div className="assistant-usage"><Icon name="gauge" size={15}/><span>{usageLine}</span></div>
        <div className="assistant-files-heading"><strong>{t("workspace")}</strong><span>{sources.length}/{limits.maxFiles}</span></div>
        <input ref={fileInput} type="file" accept={ACCEPT} multiple hidden onChange={(event) => event.target.files && void addFiles(event.target.files)} />
        <button className="assistant-add-files" type="button" disabled={busy || sources.length >= limits.maxFiles} onClick={() => fileInput.current?.click()}><Icon name="folder-plus" size={18}/>{t("addFiles")}</button>
        <small className="muted">{t("assistantAcceptedFormats")}</small>
        <div className="assistant-source-list">
          {sources.length === 0 && <div className="assistant-empty-files"><Icon name="files" size={24}/><span>{t("emptyBay")}</span></div>}
          {sources.map((source) => (
            <article className="assistant-source" key={source.id}>
              <label className="assistant-source-check"><input type="checkbox" checked={source.selected} disabled={busy} onChange={(event) => setSources((current) => current.map((item) => item.id === source.id ? { ...item, selected: event.target.checked } : item))}/></label>
              <span className="assistant-file-icon"><Icon name={source.format === "PDF" ? "file-pdf" : source.format === "XLSX" || source.format === "CSV" ? "file-spreadsheet" : source.format === "PPTX" ? "file-presentation" : "file-text"} size={18}/></span>
              <div className="assistant-source-info"><strong dir="auto" title={source.name}>{source.name}</strong><small>{source.format} · {sizeLabel(source.bytes)} · {source.text.length.toLocaleString()} {t("docCharacters")}{source.truncated ? " · …" : ""}</small></div>
              <button className="icon-button" type="button" title={t("remove")} aria-label={t("remove")} onClick={() => removeSource(source)} disabled={busy}><Icon name="x" size={15}/></button>
            </article>
          ))}
        </div>
        <div className="assistant-local-note"><Icon name="shield-check" size={16}/><span>{t("assistantLocalExtraction")}</span></div>
        <div className="assistant-workspace-footer"><span>{t("assistantSelected")}: {selectedSources.length}</span><span>{sizeLabel(totalBytes)} / {sizeLabel(limits.maxTotalBytes)}</span></div>
      </aside>

      <section className="chat assistant-chat-panel">
        <header className="assistant-chat-header">
          <div><h2>{t("assistantConversation")}</h2><p>{t("assistantConversationHint")}</p></div>
          <span className={`assistant-status-pill ${aiEnabled ? "ready" : "disabled"}`}><i/>{aiEnabled ? t("assistantAIReady") : t("assistantAIInactive")}</span>
        </header>
        {!aiEnabled && <div className="ai-disabled-banner"><Icon name="lock" size={16}/><span>{t("aiConnectionPending")}</span></div>}
        <div className="assistant-mode-row">
          <label className="field"><span>{t("assistantTask")}</span><select value={task} onChange={(event) => setTask(event.target.value as Task)} disabled={busy}>
            <option value="ask">{t("assistantTaskAsk")}</option><option value="summarize">{t("assistantTaskSummarize")}</option><option value="compare">{t("assistantTaskCompare")}</option><option value="extract">{t("assistantTaskExtract")}</option><option value="slides">{t("assistantTaskSlides")}</option>
          </select></label>
          <label className="assistant-tool-mode"><input type="checkbox" checked={toolMode} onChange={(event) => setToolMode(event.target.checked)} disabled={!agentEnabled || busy}/><span>{t("assistantAllowTools")}</span><small>{agentEnabled ? t("assistantToolsLocal") : t("assistantAgentUnavailable")}</small></label>
        </div>
        <div className="log assistant-message-list" aria-live="polite">
          {messages.length === 0 && <div className="assistant-welcome"><span className="assistant-welcome-icon"><Icon name="messages-square" size={28}/></span><strong>{t("assistantWelcomeTitle")}</strong><p>{t("assistantWelcomeText")}</p><small>{t("assistantWelcomePrivacy")}</small></div>}
          {messages.map((message, index) => {
            if (typeof message.content === "string") return <article className={`assistant-message ${message.role === "user" ? "user" : "assistant"}`} key={index}><span className="assistant-message-avatar"><Icon name={message.role === "user" ? "user" : "brain"} size={15}/></span><div className="assistant-message-body"><small>{message.role === "user" ? t("assistantYou") : t("assistantName")}</small><p dir="auto">{message.content}</p></div></article>;
            if (message.role === "user") return <article className="assistant-tool-result" key={index}>{message.content.map((block, partIndex) => block.type === "tool_result" ? <p key={partIndex} className={block.is_error ? "error" : "muted"}>{block.content}</p> : null)}</article>;
            return <div className="assistant-message assistant" key={index}>{message.content.map((block, partIndex) => block.type === "text" ? <article className="assistant-message assistant" key={partIndex}><span className="assistant-message-avatar"><Icon name="brain" size={15}/></span><div className="assistant-message-body"><small>{t("assistantName")}</small><p dir="auto">{block.text}</p></div></article> : block.type === "tool_use" ? <p className="assistant-tool-call" dir="ltr" key={partIndex}><Icon name={getTool(block.name) ? toolIcon(getTool(block.name)!) : "wrench"} size={15}/>{block.name} · {(block.input.files ?? []).join(", ")}</p> : null)}</div>;
          })}
          {busy && <p className="assistant-working" role="status"><span className="spinner"/>{t("working")}</p>}
          {notice && <p className="assistant-notice" role="status">{notice}</p>}
          {error && <p role="alert" className="error assistant-error">{error}</p>}
        </div>
        <div className="assistant-composer-wrap">
          {selectedSources.length > 0 && <div className="assistant-context-chip"><Icon name="paperclip" size={14}/>{selectedSources.length} {t("assistantSelectedDocuments")} · {context.length.toLocaleString()} {t("docCharacters")}</div>}
          <div className="composer assistant-composer">
            <textarea rows={3} value={input} maxLength={6000} placeholder={t("placeholder")} disabled={!aiEnabled || busy} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}/>
            <button className="primary assistant-send" type="button" onClick={() => void send()} disabled={!aiEnabled || busy || (!input.trim() && selectedSources.length === 0) || (toolMode && !agentEnabled)}><Icon name="send" size={16}/>{t("send")}</button>
          </div>
          <small className="assistant-disclaimer">{t("assistantSendDisclosure")}</small>
        </div>
      </section>
    </main>
  );
}

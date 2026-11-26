import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useRef, useState } from "react";
import { runAgent, uniqueName } from "../core/agent";
import { callAssistant } from "../core/ai";
import { extractDocument } from "../core/document-extract";
import { getPlanLimits } from "../core/entitlements";
import { getTool } from "../core/registry";
import { Icon, toolIcon } from "./icons";
const ACCEPT = ".pdf,.docx,.xlsx,.pptx,.txt,.csv,.tsv,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv";
const sizeLabel = (bytes) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
function taskInstruction(task, lang) {
    const instructions = {
        ask: { fa: "به پرسش کاربر بر اساس اسناد انتخاب‌شده پاسخ بده.", en: "Answer the user's question using the selected documents." },
        summarize: { fa: "اسناد انتخاب‌شده را به‌صورت ساختاریافته خلاصه کن و نکات، اعداد و اقدامات مهم را بیاور.", en: "Summarize the selected documents in a structured way, including important points, figures and action items." },
        compare: { fa: "اسناد انتخاب‌شده را مقایسه کن و تفاوت‌ها و موارد مشترک را با ارجاع منبع نشان بده.", en: "Compare the selected documents and show agreements and differences with source references." },
        extract: { fa: "اطلاعات مهم و فیلدهای ساختاریافته را استخراج کن؛ اطلاعات ناموجود را حدس نزن.", en: "Extract important facts and structured fields; do not guess missing information." },
        slides: { fa: "از اسناد انتخاب‌شده طرح ارائه پاورپوینت بساز و برای هر اسلاید منبع را مشخص کن.", en: "Create a PowerPoint outline from the selected documents and cite the source for each slide." },
    };
    return instructions[task][lang];
}
export default function Chat({ t, lang, plan, loggedIn, askLogin, aiEnabled, agentEnabled, usage }) {
    const ws = useRef(new Map());
    const fileInput = useRef(null);
    const [sources, setSources] = useState([]);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [task, setTask] = useState("ask");
    const [toolMode, setToolMode] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const limits = getPlanLimits(plan).documents;
    const totalBytes = useMemo(() => sources.reduce((sum, source) => sum + source.bytes, 0), [sources]);
    const selectedSources = useMemo(() => sources.filter((source) => source.selected), [sources]);
    const context = useMemo(() => {
        let remaining = limits.maxContextChars;
        const chunks = [];
        for (const source of selectedSources) {
            if (remaining <= 0)
                break;
            const header = `\n\n===== SOURCE: ${source.name} (${source.format}) =====\n`;
            const content = source.text.slice(0, Math.max(0, remaining - header.length - 48));
            const suffix = source.truncated || content.length < source.text.length ? "\n[Source excerpt truncated locally]" : "";
            chunks.push(`${header}${content}${suffix}\n===== END SOURCE =====`);
            remaining -= header.length + content.length + suffix.length;
        }
        return chunks.join("");
    }, [selectedSources, limits.maxContextChars]);
    async function addFiles(fileList) {
        setBusy(true);
        setError("");
        setNotice(t("assistantExtracting"));
        try {
            const incoming = Array.from(fileList);
            if (!incoming.length)
                return;
            if (sources.length + incoming.length > limits.maxFiles)
                throw new Error("document_file_count");
            if (incoming.some((file) => file.size > limits.maxFileBytes))
                throw new Error("document_file_large");
            if (totalBytes + incoming.reduce((sum, file) => sum + file.size, 0) > limits.maxTotalBytes)
                throw new Error("document_total_large");
            const prepared = [];
            for (const file of incoming) {
                const extracted = await extractDocument(file, { maxFileBytes: limits.maxFileBytes, maxUncompressedBytes: limits.maxUncompressedBytes, maxPdfPages: limits.maxPdfPages });
                const name = uniqueName(file.name, ws.current);
                ws.current.set(name, file);
                prepared.push({ ...extracted, name, id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, bytes: file.size, selected: true });
            }
            setSources((current) => [...current, ...prepared]);
            setNotice(lang === "fa" ? "متن اسناد در مرورگر استخراج شد؛ هیچ فایلی بارگذاری نشد." : "Document text was extracted locally; no file was uploaded.");
        }
        catch (caught) {
            const key = caught.message;
            setError(t(`docError.${key}`) || t("assistantPrepareFailed"));
            setNotice("");
        }
        finally {
            setBusy(false);
            if (fileInput.current)
                fileInput.current.value = "";
        }
    }
    function removeSource(source) {
        ws.current.delete(source.name);
        setSources((current) => current.filter((item) => item.id !== source.id));
    }
    async function send() {
        const prompt = input.trim();
        if ((!prompt && !selectedSources.length) || busy)
            return;
        if (!aiEnabled) {
            setError(t("aiConnectionPending"));
            return;
        }
        if (!loggedIn) {
            askLogin();
            return;
        }
        if (task === "compare" && selectedSources.length < 2) {
            setError(lang === "fa" ? "برای مقایسه حداقل دو سند انتخاب کنید." : "Select at least two documents to compare.");
            return;
        }
        if (toolMode && !agentEnabled) {
            setError(t("assistantAgentUnavailable"));
            return;
        }
        const userText = `${taskInstruction(task, lang)}${prompt ? `\n\n${prompt}` : ""}`;
        const next = [...messages, { role: "user", content: userText }];
        setMessages(next);
        setInput("");
        setBusy(true);
        setError("");
        setNotice("");
        try {
            if (toolMode) {
                const selectedWorkspace = new Map();
                for (const source of selectedSources) {
                    const file = ws.current.get(source.name);
                    if (file)
                        selectedWorkspace.set(source.name, file);
                }
                const result = await runAgent(next, selectedWorkspace, plan, setMessages);
                setMessages(result);
            }
            else {
                const history = messages.filter((message) => typeof message.content === "string").slice(-28);
                const result = await callAssistant([...history, { role: "user", content: userText }], context);
                setMessages([...next, { role: "assistant", content: result }]);
            }
        }
        catch (caught) {
            const code = caught.message;
            setError(t(`err.${code}`) === `err.${code}` ? (code === "ai_disabled" || code === "agent_disabled" ? t("aiConnectionPending") : t("assistantRequestFailed")) : t(`err.${code}`));
        }
        finally {
            setBusy(false);
        }
    }
    const usageLine = usage
        ? (lang === "fa" ? `گفت‌وگو: ${usage.agentUsed ?? 0} از ${usage.agentLimit ?? (plan === "pro" ? 300 : 10)} درخواست امروز` : `Assistant: ${usage.agentUsed ?? 0} of ${usage.agentLimit ?? (plan === "pro" ? 300 : 10)} requests today`)
        : (lang === "fa" ? `پلن ${plan === "pro" ? "Pro" : "Free"}` : `${plan === "pro" ? "Pro" : "Free"} plan`);
    return (_jsxs("main", { className: "assistant assistant-pro", children: [_jsxs("aside", { className: "bay assistant-sidebar", children: [_jsxs("div", { className: "assistant-side-title", children: [_jsx("span", { className: "assistant-symbol", children: _jsx(Icon, { name: "brain", size: 20 }) }), _jsxs("div", { children: [_jsx("h2", { children: t("assistantTitle") }), _jsx("small", { children: t("assistantWorkspaceIntro") })] })] }), _jsxs("div", { className: "assistant-usage", children: [_jsx(Icon, { name: "gauge", size: 15 }), _jsx("span", { children: usageLine })] }), _jsxs("div", { className: "assistant-files-heading", children: [_jsx("strong", { children: t("workspace") }), _jsxs("span", { children: [sources.length, "/", limits.maxFiles] })] }), _jsx("input", { ref: fileInput, type: "file", accept: ACCEPT, multiple: true, hidden: true, onChange: (event) => event.target.files && void addFiles(event.target.files) }), _jsxs("button", { className: "assistant-add-files", type: "button", disabled: busy || sources.length >= limits.maxFiles, onClick: () => fileInput.current?.click(), children: [_jsx(Icon, { name: "folder-plus", size: 18 }), t("addFiles")] }), _jsx("small", { className: "muted", children: t("assistantAcceptedFormats") }), _jsxs("div", { className: "assistant-source-list", children: [sources.length === 0 && _jsxs("div", { className: "assistant-empty-files", children: [_jsx(Icon, { name: "files", size: 24 }), _jsx("span", { children: t("emptyBay") })] }), sources.map((source) => (_jsxs("article", { className: "assistant-source", children: [_jsx("label", { className: "assistant-source-check", children: _jsx("input", { type: "checkbox", checked: source.selected, disabled: busy, onChange: (event) => setSources((current) => current.map((item) => item.id === source.id ? { ...item, selected: event.target.checked } : item)) }) }), _jsx("span", { className: "assistant-file-icon", children: _jsx(Icon, { name: source.format === "PDF" ? "file-pdf" : source.format === "XLSX" || source.format === "CSV" ? "file-spreadsheet" : source.format === "PPTX" ? "file-presentation" : "file-text", size: 18 }) }), _jsxs("div", { className: "assistant-source-info", children: [_jsx("strong", { dir: "auto", title: source.name, children: source.name }), _jsxs("small", { children: [source.format, " \u00B7 ", sizeLabel(source.bytes), " \u00B7 ", source.text.length.toLocaleString(), " ", t("docCharacters"), source.truncated ? " · …" : ""] })] }), _jsx("button", { className: "icon-button", type: "button", title: t("remove"), "aria-label": t("remove"), onClick: () => removeSource(source), disabled: busy, children: _jsx(Icon, { name: "x", size: 15 }) })] }, source.id)))] }), _jsxs("div", { className: "assistant-local-note", children: [_jsx(Icon, { name: "shield-check", size: 16 }), _jsx("span", { children: t("assistantLocalExtraction") })] }), _jsxs("div", { className: "assistant-workspace-footer", children: [_jsxs("span", { children: [t("assistantSelected"), ": ", selectedSources.length] }), _jsxs("span", { children: [sizeLabel(totalBytes), " / ", sizeLabel(limits.maxTotalBytes)] })] })] }), _jsxs("section", { className: "chat assistant-chat-panel", children: [_jsxs("header", { className: "assistant-chat-header", children: [_jsxs("div", { children: [_jsx("h2", { children: t("assistantConversation") }), _jsx("p", { children: t("assistantConversationHint") })] }), _jsxs("span", { className: `assistant-status-pill ${aiEnabled ? "ready" : "disabled"}`, children: [_jsx("i", {}), aiEnabled ? t("assistantAIReady") : t("assistantAIInactive")] })] }), !aiEnabled && _jsxs("div", { className: "ai-disabled-banner", children: [_jsx(Icon, { name: "lock", size: 16 }), _jsx("span", { children: t("aiConnectionPending") })] }), _jsxs("div", { className: "assistant-mode-row", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: t("assistantTask") }), _jsxs("select", { value: task, onChange: (event) => setTask(event.target.value), disabled: busy, children: [_jsx("option", { value: "ask", children: t("assistantTaskAsk") }), _jsx("option", { value: "summarize", children: t("assistantTaskSummarize") }), _jsx("option", { value: "compare", children: t("assistantTaskCompare") }), _jsx("option", { value: "extract", children: t("assistantTaskExtract") }), _jsx("option", { value: "slides", children: t("assistantTaskSlides") })] })] }), _jsxs("label", { className: "assistant-tool-mode", children: [_jsx("input", { type: "checkbox", checked: toolMode, onChange: (event) => setToolMode(event.target.checked), disabled: !agentEnabled || busy }), _jsx("span", { children: t("assistantAllowTools") }), _jsx("small", { children: agentEnabled ? t("assistantToolsLocal") : t("assistantAgentUnavailable") })] })] }), _jsxs("div", { className: "log assistant-message-list", "aria-live": "polite", children: [messages.length === 0 && _jsxs("div", { className: "assistant-welcome", children: [_jsx("span", { className: "assistant-welcome-icon", children: _jsx(Icon, { name: "messages-square", size: 28 }) }), _jsx("strong", { children: t("assistantWelcomeTitle") }), _jsx("p", { children: t("assistantWelcomeText") }), _jsx("small", { children: t("assistantWelcomePrivacy") })] }), messages.map((message, index) => {
                                if (typeof message.content === "string")
                                    return _jsxs("article", { className: `assistant-message ${message.role === "user" ? "user" : "assistant"}`, children: [_jsx("span", { className: "assistant-message-avatar", children: _jsx(Icon, { name: message.role === "user" ? "user" : "brain", size: 15 }) }), _jsxs("div", { className: "assistant-message-body", children: [_jsx("small", { children: message.role === "user" ? t("assistantYou") : t("assistantName") }), _jsx("p", { dir: "auto", children: message.content })] })] }, index);
                                if (message.role === "user")
                                    return _jsx("article", { className: "assistant-tool-result", children: message.content.map((block, partIndex) => block.type === "tool_result" ? _jsx("p", { className: block.is_error ? "error" : "muted", children: block.content }, partIndex) : null) }, index);
                                return _jsx("div", { className: "assistant-message assistant", children: message.content.map((block, partIndex) => block.type === "text" ? _jsxs("article", { className: "assistant-message assistant", children: [_jsx("span", { className: "assistant-message-avatar", children: _jsx(Icon, { name: "brain", size: 15 }) }), _jsxs("div", { className: "assistant-message-body", children: [_jsx("small", { children: t("assistantName") }), _jsx("p", { dir: "auto", children: block.text })] })] }, partIndex) : block.type === "tool_use" ? _jsxs("p", { className: "assistant-tool-call", dir: "ltr", children: [_jsx(Icon, { name: getTool(block.name) ? toolIcon(getTool(block.name)) : "wrench", size: 15 }), block.name, " \u00B7 ", (block.input.files ?? []).join(", ")] }, partIndex) : null) }, index);
                            }), busy && _jsxs("p", { className: "assistant-working", role: "status", children: [_jsx("span", { className: "spinner" }), t("working")] }), notice && _jsx("p", { className: "assistant-notice", role: "status", children: notice }), error && _jsx("p", { role: "alert", className: "error assistant-error", children: error })] }), _jsxs("div", { className: "assistant-composer-wrap", children: [selectedSources.length > 0 && _jsxs("div", { className: "assistant-context-chip", children: [_jsx(Icon, { name: "paperclip", size: 14 }), selectedSources.length, " ", t("assistantSelectedDocuments"), " \u00B7 ", context.length.toLocaleString(), " ", t("docCharacters")] }), _jsxs("div", { className: "composer assistant-composer", children: [_jsx("textarea", { rows: 3, value: input, maxLength: 6000, placeholder: t("placeholder"), disabled: !aiEnabled || busy, onChange: (event) => setInput(event.target.value), onKeyDown: (event) => { if (event.key === "Enter" && !event.shiftKey) {
                                            event.preventDefault();
                                            void send();
                                        } } }), _jsxs("button", { className: "primary assistant-send", type: "button", onClick: () => void send(), disabled: !aiEnabled || busy || (!input.trim() && selectedSources.length === 0) || (toolMode && !agentEnabled), children: [_jsx(Icon, { name: "send", size: 16 }), t("send")] })] }), _jsx("small", { className: "assistant-disclaimer", children: t("assistantSendDisclosure") })] })] })] }));
}

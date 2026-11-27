import { useEffect, useState } from "react";
import { tools } from "../core/registry";
import { pickFiles, downloadAll } from "../core/file-access";
import { validateFiles } from "../core/file-validation";
import { callAI, getAIFeatureStatus, type AIFeatureStatus } from "../core/ai";
import type { WorkspaceSummary } from "../core/local-workspace";
import { api, checkAccess, fetchMe, getToken, setToken, type Me } from "../core/permissions";
import { getPlanLimits, getToolFileLimit } from "../core/entitlements";
import { setWorkspacePlan } from "../core/local-workspace";
import { getInitialLang, makeT, type Lang } from "../core/i18n";
import type { Tool } from "../core/types";
import type { TextHandoff } from "../core/workflow";
import { AuthForm, LegacyPasswordSetup, Pricing, type AuthMode } from "./Account";
import Chat from "./Chat";
import Hero from "./Hero";
import About from "./About";
import Legal from "./Legal";
import Feedback from "./Feedback";
import PDFEditor from "./PDFEditor";
import ScanCenter from "./ScanCenter";
import WordWorkspace from "./WordWorkspace";
import ExcelWorkspace from "./ExcelWorkspace";
import PowerPointWorkspace from "./PowerPointWorkspace";
import DocumentIntelligence from "./DocumentIntelligence";
import Translator from "./Translator";
import WorkspaceLibrary from "./WorkspaceLibrary";
import { Icon, toolIcon } from "./icons";
import { getDeviceFolderStatus, type DeviceFolderStatus } from "../core/device-folder";

type View = "tools" | "scan" | "editor" | "word" | "excel" | "ppt" | "documents" | "translate" | "assistant" | "library" | "plans" | "feedback" | "about" | "privacy" | "terms";
const fromHash = (): View => { const h = location.hash.slice(1); return ["scan", "editor", "word", "excel", "ppt", "documents", "translate", "assistant", "library", "plans", "feedback", "about", "privacy", "terms"].includes(h) ? h as View : "tools"; };
const CATS = ["pdf", "image", "ai", "files"] as const;
type Theme = "light" | "dark";
const getInitialTheme = (): Theme => {
  try {
    const stored = localStorage.getItem("pdat-theme");
    if (stored === "light" || stored === "dark") return stored;
  } catch { /* Storage may be unavailable in private browsing. */ }
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

export default function App() {
  const [lang, setLang] = useState<Lang>(getInitialLang);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [me, setMe] = useState<Me | null>(null);
  const [aiFeatures, setAIFeatures] = useState<AIFeatureStatus>({ aiEnabled: false, chatEnabled: false, documentsEnabled: false, agentEnabled: false, providerConfigured: false, reason: "disabled", capabilities: [] });
  const [tab, setTab] = useState<View>(fromHash);
  const [active, setActive] = useState<Tool>(tools[0]);
  const [opts, setOpts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState("");
  const [text, setText] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [handoff, setHandoff] = useState<TextHandoff | null>(null);
  const [pendingSavedItem, setPendingSavedItem] = useState<WorkspaceSummary | null>(null);
  const [saveNotice, setSaveNotice] = useState("");
  const [emailVerifyCode, setEmailVerifyCode] = useState("");
  const [emailVerifySent, setEmailVerifySent] = useState(false);
  const [emailVerifyBusy, setEmailVerifyBusy] = useState(false);
  const [emailVerifyMessage, setEmailVerifyMessage] = useState("");
  const t = makeT(lang);
  const openAuth = (mode: AuthMode = "login") => { setAuthMode(mode); setShowAuth(true); };
  const plan = me?.plan ?? "free";
  const limits = getPlanLimits(plan);
  const go = (v: View) => {
    setTab(v);
    const nextUrl = v === "tools"
      ? `${location.pathname}${location.search}`
      : `${location.pathname}${location.search}#${v}`;
    const currentUrl = `${location.pathname}${location.search}${location.hash}`;
    if (currentUrl !== nextUrl) history.pushState(null, "", nextUrl);
    window.scrollTo(0, 0);
  };
  const makeHandoff = (name: string, text: string, source: TextHandoff["source"]) => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setHandoff({ id, name, text, source });
  };
  const consumeHandoff = (id: string) => setHandoff((current) => current?.id === id ? null : current);
  const sendToWord = (name: string, content: string, source: TextHandoff["source"]) => {
    makeHandoff(name, content, source);
    go("word");
  };
  const sendToDocuments = (name: string, content: string, source: TextHandoff["source"]) => {
    makeHandoff(name, content, source);
    go("documents");
  };
  const sendToTranslator = (name: string, content: string, source: TextHandoff["source"]) => {
    makeHandoff(name, content, source);
    go("translate");
  };
  const refreshPlan = async (): Promise<boolean> => {
    if (!getToken()) return false;
    const latest = await fetchMe();
    if (!latest) return false;
    setMe(latest);
    setWorkspacePlan(latest.plan);
    return true;
  };
  useEffect(() => {
    const syncRoute = () => { setTab(fromHash()); window.scrollTo(0, 0); };
    window.addEventListener("popstate", syncRoute);
    window.addEventListener("hashchange", syncRoute);
    return () => {
      window.removeEventListener("popstate", syncRoute);
      window.removeEventListener("hashchange", syncRoute);
    };
  }, []);
  useEffect(() => {
    let timeout = 0;
    const onSaved = (event: Event) => {
      const filename = (event as CustomEvent<{ filename?: string }>).detail?.filename ?? "";
      setSaveNotice(lang === "fa" ? `در پوشه انتخابی ذخیره شد: ${filename}` : `Saved to your selected folder: ${filename}`);
      window.clearTimeout(timeout); timeout = window.setTimeout(() => setSaveNotice(""), 5200);
    };
    const onFallback = (event: Event) => {
      const filename = (event as CustomEvent<{ filename?: string }>).detail?.filename ?? "";
      setSaveNotice(lang === "fa" ? `اجازه پوشه در دسترس نبود؛ فایل با روش معمول مرورگر ذخیره شد: ${filename}` : `Folder permission was unavailable; used the normal browser download: ${filename}`);
      window.clearTimeout(timeout); timeout = window.setTimeout(() => setSaveNotice(""), 7000);
    };
    window.addEventListener("pdat:folder-saved", onSaved);
    window.addEventListener("pdat:folder-save-fallback", onFallback);
    return () => { window.removeEventListener("pdat:folder-saved", onSaved); window.removeEventListener("pdat:folder-save-fallback", onFallback); window.clearTimeout(timeout); };
  }, [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
    try { localStorage.setItem("lang", lang); } catch { /* The selected language remains active for this session. */ }
  }, [lang]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("pdat-theme", theme); } catch { /* Keep theme for this session if storage is blocked. */ }
    const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (themeColor) themeColor.content = theme === "dark" ? "#101b19" : "#f4f7f5";
  }, [theme]);
  useEffect(() => {
    fetchMe().then((latest) => { if (latest) { setMe(latest); setWorkspacePlan(latest.plan); } });
    void getAIFeatureStatus(true).then(setAIFeatures);
    const b = new URLSearchParams(location.search).get("billing");
    if (b) setStatus(t(b === "success" ? "billingSuccess" : "billingFailed"));
  }, []);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") {
        void refreshPlan();
        void getAIFeatureStatus(true).then(setAIFeatures);
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, []);

  useEffect(() => {
    if (!me || me.emailVerified || me.emailVerificationWarning || !me.emailVerificationWarningAt) return;
    const delay = Math.max(0, me.emailVerificationWarningAt * 1000 - Date.now() + 100);
    const timer = window.setTimeout(() => {
      void fetchMe().then((latest) => {
        if (latest) { setMe(latest); setWorkspacePlan(latest.plan); }
      });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [me?.emailVerified, me?.emailVerificationWarning, me?.emailVerificationWarningAt]);

  useEffect(() => { setWorkspacePlan(plan); }, [plan]);
  useEffect(() => { setOpts(Object.fromEntries((active.options ?? []).map((o) => [o.key, o.default]))); setText(""); setStatus(""); }, [active]);

  async function requestEmailVerification() {
    if (emailVerifyBusy) return;
    setEmailVerifyBusy(true); setEmailVerifyMessage("");
    try { await api("/api/auth/verification/request", {}); setEmailVerifySent(true); setEmailVerifyMessage(t("emailCodeSent")); }
    catch (error) { setEmailVerifyMessage(t("err." + (error as Error).message)); }
    finally { setEmailVerifyBusy(false); }
  }
  async function confirmEmailVerification() {
    if (!/^\d{6}$/.test(emailVerifyCode) || emailVerifyBusy) return;
    setEmailVerifyBusy(true); setEmailVerifyMessage("");
    try {
      await api("/api/auth/verification/confirm", { code: emailVerifyCode });
      const latest = await fetchMe();
      if (latest) { setMe(latest); setWorkspacePlan(latest.plan); }
      setEmailVerifySent(false); setEmailVerifyCode(""); setEmailVerifyMessage(t("emailVerifiedSuccess"));
    } catch (error) { setEmailVerifyMessage(t("err." + (error as Error).message)); }
    finally { setEmailVerifyBusy(false); }
  }

  async function signOut() {
    try { await api<{ ok: boolean }>("/api/auth/logout", {}); }
    catch { /* Clear the local session even when the Worker cannot be reached. */ }
    setToken(null);
    setMe(null);
  }

  async function run(tool: Tool) {
    setText(""); setStatus("");
    try {
      if (tool.usesAI && !aiFeatures.documentsEnabled) throw new Error("ai_disabled");
      if (tool.usesAI && !me) { openAuth("login"); throw new Error("login_required"); }
      const files = await pickFiles(tool.accepts, tool.multiple);
      if (!files.length) return;
      const denied = checkAccess(tool, plan, files.length);
      if (denied) throw new Error(denied);
      const maxPages = plan === "pro" ? (tool.maxPdfPagesPro ?? limits.files.maxPdfPages) : (tool.maxPdfPages ?? limits.files.maxPdfPages);
      await validateFiles(files, tool.accepts, tool.multiple, maxPages, plan);
      setStatus(t("processing"));
      const res = await tool.run(files, { options: opts, callAI });
      if (res.files) await downloadAll(res.files);
      if (res.text) setText(res.text);
      setStatus(t("done"));
    } catch (e) {
      const code = (e as Error).message;
      if (code === "AbortError") { setStatus(""); return; }
      if (code === "upgrade_batch") {
        const freeCap = getToolFileLimit(tool, "free");
        const proCap = getToolFileLimit(tool, "pro");
        setStatus(lang === "fa" ? `سقف پلن Free برای این ابزار ${freeCap} فایل است؛ در Pro تا ${proCap} فایل پشتیبانی می‌شود. از بخش پلن‌ها می‌توانید مقایسه کنید.` : `This tool allows ${freeCap} file(s) on Free and up to ${proCap} on Pro. Compare plans to upgrade.`);
      } else if (code === "too_many_files") {
        setStatus(lang === "fa" ? `تعداد فایل از سقف پلن Pro برای این ابزار (${getToolFileLimit(tool, "pro")}) بیشتر است.` : `File count exceeds this tool's Pro limit (${getToolFileLimit(tool, "pro")}).`);
      } else if (code === "file_too_large") {
        setStatus(lang === "fa" ? `حداکثر حجم هر فایل در پلن ${plan === "pro" ? "Pro" : "Free"} برابر ${Math.round(limits.files.maxFileBytes / 1048576)} مگابایت است.` : `The per-file limit on ${plan === "pro" ? "Pro" : "Free"} is ${Math.round(limits.files.maxFileBytes / 1048576)} MB.`);
      } else if (code === "batch_too_large") {
        setStatus(lang === "fa" ? `حجم مجموع این عملیات نباید از ${Math.round(limits.files.maxTotalBytes / 1048576)} مگابایت بیشتر شود.` : `Combined input size must not exceed ${Math.round(limits.files.maxTotalBytes / 1048576)} MB.`);
      } else setStatus(t("err." + code));
    }
  }

  return (
    <div className="shell">
      <header className="bar">
        <h1 className="brand"><img src="/favicon.svg" alt="" width="30" height="30" />{t("title")}</h1>
        <span className="chip"><i />{t("chip")}</span>
        <span className="spacer" />
        <button onClick={() => go("plans")}><Icon name="crown" size={16} />{lang === "fa" ? "پلن‌ها" : "Plans"}</button>
        <button type="button" className={`account-plan-pill ${plan === "pro" ? "is-pro" : "is-free"}`} onClick={() => go("plans")} title={lang === "fa" ? "مشاهده وضعیت اشتراک و محدودیت‌ها" : "View plan status and limits"}><Icon name={plan === "pro" ? "crown" : "sparkles"} size={15}/><strong>{plan === "pro" ? "Pro" : "Free"}</strong></button>
        <button type="button" className="theme-toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? t("themeToLight") : t("themeToDark")} title={theme === "dark" ? t("themeToLight") : t("themeToDark")}><Icon name={theme === "dark" ? "sun" : "moon"} size={16} /><span>{theme === "dark" ? t("themeLight") : t("themeDark")}</span></button>
        <button onClick={() => setLang(lang === "fa" ? "en" : "fa")}><Icon name="globe" size={16} />{lang === "fa" ? "English" : "فارسی"}</button>
        {me ? <button onClick={() => void signOut()}><Icon name="logout" size={16} />{t("logout")} · {me.email}</button> : (
          <div className="auth-header-actions">
            <button type="button" onClick={() => openAuth("login")}><Icon name="user" size={16} />{t("login")}</button>
            <button type="button" className="primary" onClick={() => openAuth("register")}><Icon name="user" size={16} />{t("createAccount")}</button>
          </div>
        )}
      </header>

      {me && !me.emailVerified && me.emailVerificationWarning && <section className="email-verification-warning" role="status" aria-live="polite">
        <div className="email-verification-warning-copy">
          <strong>{t("emailUnverifiedTitle")}</strong>
          <p>{t("emailUnverifiedAfterDay")}</p>
          {emailVerifyMessage && <small>{emailVerifyMessage}</small>}
        </div>
        {me.emailVerificationEnabled && (!emailVerifySent ?
          <button type="button" className="secondary" disabled={emailVerifyBusy} onClick={() => void requestEmailVerification()}>{emailVerifyBusy ? t("processing") : t("sendVerificationCode")}</button> :
          <div className="email-verification-actions">
            <input aria-label={t("code")} inputMode="numeric" maxLength={6} value={emailVerifyCode} onChange={(event) => setEmailVerifyCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={t("code")} dir="ltr" />
            <button type="button" className="primary" disabled={emailVerifyBusy || emailVerifyCode.length !== 6} onClick={() => void confirmEmailVerification()}>{emailVerifyBusy ? t("processing") : t("verify")}</button>
          </div>) }
      </section>}
      {me && me.passwordReady === false && <LegacyPasswordSetup t={t} onDone={() => { fetchMe().then((latest) => { if (latest) setMe(latest); }); }} />}

      {saveNotice && <div className="device-save-notice" role="status"><Icon name="folder-open" size={16}/><span>{saveNotice}</span><button type="button" onClick={() => setSaveNotice("")} aria-label={lang === "fa" ? "بستن پیام" : "Dismiss notice"}>×</button></div>}
      {showAuth && !me && <AuthForm t={t} mode={authMode} onModeChange={setAuthMode} onClose={() => setShowAuth(false)} onDone={() => { setShowAuth(false); fetchMe().then(setMe); }} />}

      {tab === "tools" && <Hero t={t} onAbout={() => go("about")} />}
      <nav className="tabs" aria-label={t("navMain")}>
        <div className="tabs-group tabs-workspaces" aria-label={t("navWorkspaces")}>
          {(["tools", "scan", "editor", "word", "excel", "ppt", "translate", "documents"] as const).map((k) => (
            <button key={k} type="button" aria-current={tab === k ? "page" : undefined} className={tab === k ? "active" : ""} onClick={() => go(k)}>
              <Icon name={k === "tools" ? "tools" : k === "documents" ? "brain" : k === "translate" ? "languages" : k} size={17} />{t({ tools: "tabTools", scan: "tabScan", editor: "tabEditor", word: "tabWord", excel: "tabExcel", ppt: "tabPowerPoint", documents: "tabDocsAI", translate: "tabTranslator" }[k])}
            </button>
          ))}
        </div>
        <span className="tabs-divider" aria-hidden="true" />
        <div className="tabs-group tabs-manage" aria-label={t("navManagement")}>
          {(["library", "plans", "assistant", "feedback", "about"] as const).map((k) => (
            <button key={k} type="button" aria-current={tab === k ? "page" : undefined} className={tab === k ? "active" : ""} onClick={() => go(k)}>
              <Icon name={k === "plans" ? "crown" : k === "library" ? "library" : k} size={17} />{t({ library: "tabLibrary", plans: "tabPlans", assistant: "tabAssistant", feedback: "tabFeedback", about: "tabAbout" }[k])}
            </button>
          ))}
        </div>
      </nav>

      {tab === "tools" && <WorkspaceHub lang={lang} onNavigate={go} plan={plan} />}
      {tab === "plans" && <Pricing t={t} lang={lang} me={me} onLogin={() => openAuth("login")} onRefresh={refreshPlan} />}

      {tab === "plans" ? null : tab === "library" ? <WorkspaceLibrary lang={lang} plan={plan} onOpen={(item) => { setPendingSavedItem(item); go(item.kind); }} /> :
      tab === "about" ? <About lang={lang} /> : tab === "privacy" || tab === "terms" ? <Legal lang={lang} doc={tab} /> :
        tab === "scan" ? <ScanCenter t={t} lang={lang} plan={plan} onSendToWord={(name, content) => sendToWord(name, content, "scan")} onSendToDocuments={(name, content) => sendToDocuments(name, content, "scan")} onSendToTranslator={(name, content) => sendToTranslator(name, content, "scan")} /> :
        tab === "editor" ? <PDFEditor t={t} lang={lang} plan={plan} /> :
        tab === "word" ? <WordWorkspace t={t} lang={lang} plan={plan} handoff={tab === "word" ? handoff : null} onHandoffConsumed={consumeHandoff} onSendToDocuments={(name, content) => sendToDocuments(name, content, "word")} savedItemId={pendingSavedItem?.kind === "word" ? pendingSavedItem.id : null} onSavedItemLoaded={() => setPendingSavedItem(null)} /> :
        tab === "excel" ? <ExcelWorkspace t={t} lang={lang} plan={plan} savedItemId={pendingSavedItem?.kind === "excel" ? pendingSavedItem.id : null} onSavedItemLoaded={() => setPendingSavedItem(null)} /> :
        tab === "ppt" ? <PowerPointWorkspace t={t} lang={lang} plan={plan} savedItemId={pendingSavedItem?.kind === "ppt" ? pendingSavedItem.id : null} onSavedItemLoaded={() => setPendingSavedItem(null)} /> :
        tab === "documents" ? <DocumentIntelligence t={t} lang={lang} aiEnabled={aiFeatures.documentsEnabled} plan={plan} loggedIn={!!me} askLogin={() => openAuth("login")} handoff={tab === "documents" ? handoff : null} onHandoffConsumed={consumeHandoff} onSendToWord={(name, content) => sendToWord(name, content, "ai")} savedItemId={pendingSavedItem?.kind === "documents" ? pendingSavedItem.id : null} onSavedItemLoaded={() => setPendingSavedItem(null)} /> :
        tab === "translate" ? <Translator t={t} lang={lang} plan={plan} loggedIn={!!me} askLogin={() => openAuth("login")} handoff={tab === "translate" ? handoff : null} onHandoffConsumed={consumeHandoff} onSendToWord={(name, content) => sendToWord(name, content, "translator")} onOpenPlans={() => go("plans")} /> :
        tab === "feedback" ? <Feedback t={t} lang={lang} /> :
        tab === "assistant" ? <Chat t={t} lang={lang} plan={plan} loggedIn={!!me} askLogin={() => openAuth("login")} aiEnabled={aiFeatures.chatEnabled} agentEnabled={aiFeatures.agentEnabled} usage={me?.usage} /> : (
        <div className="workbench" id="workbench">
          <div className={`workbench-plan-banner ${plan === "pro" ? "is-pro" : "is-free"}`}>
            <span className="workbench-plan-icon"><Icon name={plan === "pro" ? "crown" : "sparkles"} size={18}/></span>
            <span><strong>{plan === "pro" ? (lang === "fa" ? "پلن Pro فعال" : "Pro plan active") : (lang === "fa" ? "پلن Free فعال" : "Free plan active")}</strong><small>{lang === "fa" ? `سقف عمومی: ${Math.round(limits.files.maxFileBytes / 1048576)} مگابایت برای هر فایل · ${Math.round(limits.files.maxTotalBytes / 1048576)} مگابایت مجموع · سقف صفحات بر اساس ابزار` : `General limits: ${Math.round(limits.files.maxFileBytes / 1048576)} MB per file · ${Math.round(limits.files.maxTotalBytes / 1048576)} MB total · page caps vary by tool`}</small></span>
            <button type="button" onClick={() => go("plans")}>{lang === "fa" ? "مقایسه پلن‌ها" : "Compare plans"}</button>
          </div>
          <nav className="rail">
            {CATS.map((c) => {
              const list = tools.filter((x) => x.category === c);
              return list.length ? (
                <div key={c}>
                  <h2><Icon name={c} size={16} />{t("cat." + c)}</h2>
                  {list.map((x) => (
                    <button key={x.id} className="tool" data-cat={x.category} aria-current={x.id === active.id} onClick={() => setActive(x)}>
                      <span className="tl"><Icon name={toolIcon(x)} size={18} />{x.name[lang]}</span>{x.plan === "pro" && <b className="badge">{t("pro")}</b>}
                    </button>
                  ))}
                </div>
              ) : null;
            })}
          </nav>
          <section className="panel">
            <div className="phead" data-cat={active.category}><span className="tile"><Icon name={toolIcon(active)} size={26} /></span><h2>{active.name[lang]}</h2></div>
            <p className="muted">{active.description[lang]}</p>
            <div className="tool-plan-limit">
              <span><Icon name="gauge" size={15}/>{lang === "fa" ? `پلن ${plan === "pro" ? "Pro" : "Free"} · سقف این عملیات: ${getToolFileLimit(active, plan)} فایل` : `${plan === "pro" ? "Pro" : "Free"} plan · operation limit: ${getToolFileLimit(active, plan)} file(s)`}</span>
              {plan !== "pro" && getToolFileLimit(active, "pro") > getToolFileLimit(active, "free") && <button type="button" onClick={() => go("plans")}>{lang === "fa" ? `Pro تا ${getToolFileLimit(active, "pro")} فایل` : `Pro: up to ${getToolFileLimit(active, "pro")} files`}</button>}
            </div>
            {active.options?.map((o) => (
              <label key={o.key} className="field">
                <span>{o.label[lang]}</span>
                {o.choices ? (
                  <select value={opts[o.key] ?? ""} onChange={(e) => setOpts({ ...opts, [o.key]: e.target.value })}>
                    {o.choices.map((c) => <option key={c}>{c}</option>)}
                  </select>
                ) : <input value={opts[o.key] ?? ""} dir="ltr" onChange={(e) => setOpts({ ...opts, [o.key]: e.target.value })} />}
              </label>
            ))}
            <button className="drop" onClick={() => run(active)}>
              <Icon name="upload" size={28} /><strong>{t("run")}</strong>
              <span dir="ltr">{active.accepts.map((m) => m.split("/")[1].toUpperCase().replace("JPEG", "JPG")).join(" · ")}</span>
            </button>
            {status && <p role="status">{status}</p>}
            {text && <pre>{text}</pre>}
          </section>
        </div>
      )}
      <footer className="foot">
        <span>{t("footer")}</span>
        <nav><a href="#scan">{t("tabScan")}</a><a href="#word">{t("tabWord")}</a><a href="#excel">{t("tabExcel")}</a><a href="#ppt">{t("tabPowerPoint")}</a><a href="#documents">{t("tabDocsAI")}</a><a href="#translate">{t("tabTranslator")}</a><a href="#library">{t("tabLibrary")}</a><a href="#plans">{t("tabPlans")}</a><a href="#feedback">{t("tabFeedback")}</a><a href="#about">{t("tabAbout")}</a><a href="#privacy">{t("privacyLink")}</a><a href="#terms">{t("termsLink")}</a></nav>
      </footer>
    </div>
  );
}


type HubView = "scan" | "editor" | "word" | "excel" | "ppt" | "documents" | "translate" | "library";
function WorkspaceHub({ lang, onNavigate, plan }: { lang: Lang; onNavigate: (view: View) => void; plan: "free" | "pro" }) {
  const fa = lang === "fa";
  const [folderStatus, setFolderStatus] = useState<DeviceFolderStatus>({ supported: false, connected: false, name: null, permission: "unknown" });
  useEffect(() => {
    let active = true;
    void getDeviceFolderStatus().then((status) => { if (active) setFolderStatus(status); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const folderReady = folderStatus.supported && folderStatus.connected && folderStatus.permission === "granted";
  const folderNeedsPermission = folderStatus.connected && folderStatus.permission !== "granted";
  const cards: Array<{ id: HubView; icon: string; title: string; description: string; tone: string; tag: string }> = [
    { id: "scan", icon: "scan", title: fa ? "اسکن و OCR" : "Scan & OCR", description: fa ? "تبدیل عکس و سند اسکن‌شده به متن قابل ویرایش" : "Turn scanned pages and images into editable text", tone: "mint", tag: fa ? "اسکن هوشمند" : "Smart scan" },
    { id: "editor", icon: "editor", title: fa ? "ویرایش PDF" : "PDF Editor", description: fa ? "مدیریت صفحات، افزودن متن و امضا" : "Manage pages, add text and signatures", tone: "amber", tag: fa ? "ابزار PDF" : "PDF tools" },
    { id: "word", icon: "word", title: fa ? "فضای Word" : "Word Workspace", description: fa ? "ساخت و ویرایش سندهای متنی" : "Create and edit text documents", tone: "blue", tag: "DOCX" },
    { id: "excel", icon: "excel", title: fa ? "فضای Excel" : "Excel Workspace", description: fa ? "جدول، فرمول و تحلیل داده‌ها" : "Spreadsheets, formulas and data", tone: "green", tag: "XLSX" },
    { id: "ppt", icon: "ppt", title: fa ? "فضای ارائه" : "Presentation Workspace", description: fa ? "ساخت و ویرایش اسلایدها" : "Build and edit slide decks", tone: "orange", tag: "PPTX" },
    { id: "documents", icon: "brain", title: fa ? "هوش اسناد" : "AI Documents", description: fa ? "محیط آماده برای پرسش، مقایسه و استخراج اطلاعات؛ اتصال فعلاً غیرفعال است" : "Prepared for Q&A, compare and extraction; connection is currently disabled", tone: "violet", tag: fa ? "آماده · غیرفعال" : "Ready · offline" },
    { id: "translate", icon: "languages", title: fa ? "مترجم هوشمند" : "Smart Translator", description: fa ? "ترجمه متن با انتخاب زبان و سهمیه مستقل Free و Pro" : "Translate text with language selection and separate Free/Pro quotas", tone: "blue", tag: fa ? "ترجمه" : "Translate" },
    { id: "library", icon: "library", title: fa ? "فضای کاری من" : "My Workspace", description: fa ? "اتصال پوشه دلخواه، ذخیره محلی و بازیابی پروژه‌ها" : "Connect your folder, save locally and restore projects", tone: "slate", tag: fa ? "ذخیره محلی" : "Local storage" },
  ];
  return <section className="workspace-hub" aria-label={fa ? "فضاهای کاری" : "Workspaces"}>
    <div className="hub-heading">
      <div><span className="hub-eyebrow">{fa ? "همه ابزارها در یک محیط" : "YOUR DOCUMENT WORKSPACE"}</span><h2>{fa ? "از کجا شروع می‌کنید؟" : "What would you like to work on?"}</h2><p>{fa ? "یک فضای کاری انتخاب کنید و بدون جابه‌جایی بین چند برنامه، کارتان را ادامه دهید." : "Choose a workspace and keep your document work in one place."}</p></div>
      <span className="hub-count">{fa ? "۷ فضای کاری" : "7 workspaces"}</span>
    </div>
    <button type="button" className={`hub-plan-status ${plan === "pro" ? "is-pro" : "is-free"}`} onClick={() => onNavigate("plans")}>
      <span className="hub-plan-mark"><Icon name={plan === "pro" ? "crown" : "sparkles"} size={19}/></span>
      <span><strong>{plan === "pro" ? (fa ? "اشتراک حرفه‌ای فعال است" : "Pro plan is active") : (fa ? "شما از پلن رایگان استفاده می‌کنید" : "You are on the Free plan")}</strong><small>{fa ? "مشاهده محدودیت‌ها و مقایسه کامل پلن‌ها" : "View the full plan limits and comparison"}</small></span>
      <Icon name="chevron-left" size={17}/>
    </button>
    <div className={`hub-folder-setup ${folderReady ? "is-connected" : ""}`}>
      <span className="hub-folder-setup-icon"><Icon name={folderReady ? "file-check" : "folder-open"} size={22}/></span>
      <div className="hub-folder-setup-copy">
        <strong>{folderReady
          ? (fa ? `پوشه ذخیره‌سازی متصل است: ${folderStatus.name ?? "پوشه انتخابی"}` : `Storage folder connected: ${folderStatus.name ?? "Selected folder"}`)
          : folderNeedsPermission
            ? (fa ? "پوشه متصل است؛ اجازه دسترسی را دوباره تأیید کنید" : "Folder connected; permission needs renewal")
            : folderStatus.supported
              ? (fa ? "برای ذخیره خودکار، پوشه شخصی‌تان را انتخاب کنید" : "Choose a personal folder for automatic saving")
              : (fa ? "ذخیره‌سازی روی دستگاه شما" : "Save files on your device")}</strong>
        <p>{folderReady
          ? (fa ? "خروجی‌ها و نسخه‌های کاری در پوشه‌ای که اجازه داده‌اید ذخیره می‌شوند." : "Exports and workspace drafts are saved in the folder you approved.")
          : folderNeedsPermission
            ? (fa ? "مجوز پوشه ممکن است توسط مرورگر منقضی یا لغو شده باشد؛ از فضای کاری من دوباره اجازه بدهید." : "The browser may have expired or revoked access. Re-authorize the folder in My Workspace.")
            : folderStatus.supported
              ? (fa ? "فقط با انتخاب و اجازه شما متصل می‌شویم؛ اسناد در پایگاه داده سرور ذخیره نمی‌شوند. اگر پوشه را انتخاب نکنید، دانلود معمول مرورگر در دسترس است." : "We connect only after you choose and approve a folder. Documents are not stored in a server database. Normal browser downloads remain available if you skip this.")
              : (fa ? "این مرورگر اتصال مستقیم پوشه را ارائه نمی‌کند؛ فایل‌ها با روش ذخیره یا دانلود معمول دستگاه ذخیره می‌شوند." : "This browser does not expose direct folder linking; files use the device's normal save or download flow.")}</p>
      </div>
      <button type="button" className={folderReady ? "hub-folder-manage" : "primary"} onClick={() => onNavigate("library")}>
        <Icon name={folderReady || folderNeedsPermission ? "file-check" : "folder-open"} size={16}/>{fa ? (folderReady ? "مدیریت پوشه" : folderNeedsPermission ? "تأیید مجوز" : "انتخاب پوشه") : (folderReady ? "Manage folder" : folderNeedsPermission ? "Grant access" : "Choose folder")}
      </button>
    </div>
    <div className="hub-grid">
      {cards.map((card) => <button key={card.id} className={`hub-card ${card.tone}`} onClick={() => onNavigate(card.id)}>
        <span className="hub-card-top"><span className="hub-icon"><Icon name={card.icon} size={23} /></span><span className="hub-tag">{card.tag}</span></span>
        <strong>{card.title}</strong><span className="hub-description">{card.description}</span><span className="hub-open">{fa ? "باز کردن فضا" : "Open workspace"}<Icon name="chevron-down" size={15} /></span>
      </button>)}
    </div>
  </section>;
}

import { useEffect, useMemo, useState } from "react";
import type { Lang } from "../core/i18n";
import type { Plan } from "../core/types";
import type { TextHandoff } from "../core/workflow";
import { api } from "../core/permissions";
import { getPlanLimits } from "../core/entitlements.js";
import { saveBlobToDeviceOrDownload } from "../core/device-folder";
import { Icon } from "./icons";

type TranslationLanguage = "fa" | "en" | "ar" | "fr" | "de" | "es" | "it" | "tr" | "ru" | "zh" | "ja";
type TranslationUsage = {
  enabled: boolean;
  plan: Plan;
  used: number;
  limit: number;
  remaining: number;
  maxCharacters: number;
  resetAt: number;
  quotaDay: string;
};
type TranslationResult = {
  translatedText: string;
  detectedSourceLanguage: TranslationLanguage | null;
  used: number;
  limit: number;
  remaining: number;
  maxCharacters: number;
  resetAt: number;
};
type Props = {
  t: (key: string) => string;
  lang: Lang;
  plan: Plan;
  loggedIn: boolean;
  askLogin: () => void;
  handoff: TextHandoff | null;
  onHandoffConsumed: (id: string) => void;
  onSendToWord: (name: string, text: string) => void;
  onOpenPlans: () => void;
};

const LANGUAGE_OPTIONS: Array<{ code: TranslationLanguage; key: string }> = [
  { code: "fa", key: "translateLangFa" }, { code: "en", key: "translateLangEn" },
  { code: "ar", key: "translateLangAr" }, { code: "fr", key: "translateLangFr" },
  { code: "de", key: "translateLangDe" }, { code: "es", key: "translateLangEs" },
  { code: "it", key: "translateLangIt" }, { code: "tr", key: "translateLangTr" },
  { code: "ru", key: "translateLangRu" }, { code: "zh", key: "translateLangZh" },
  { code: "ja", key: "translateLangJa" },
];
const RTL_LANGUAGES = new Set(["fa", "ar"]);

function messageKey(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (["translation_disabled", "translation_too_long", "translation_limit_reached", "translation_unsupported_language", "translation_same_language", "translation_provider_busy", "translation_provider_failed", "translation_timeout", "translation_response_truncated", "login_required", "too_many", "invalid_input"].includes(code)) return `err.${code}`;
  return "err.translation_provider_failed";
}

function resetLabel(resetAt: number, lang: Lang): string {
  const date = new Date(resetAt * 1000);
  return new Intl.DateTimeFormat(lang === "fa" ? "fa-IR" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(date);
}

function safeFileName(value: string): string {
  const clean = value.replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 70);
  return clean || "translation";
}

export default function Translator({ t, lang, plan, loggedIn, askLogin, handoff, onHandoffConsumed, onSendToWord, onOpenPlans }: Props) {
  const [sourceText, setSourceText] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState<"auto" | TranslationLanguage>("auto");
  const [targetLanguage, setTargetLanguage] = useState<TranslationLanguage>(lang === "fa" ? "en" : "fa");
  const [translatedText, setTranslatedText] = useState("");
  const [detectedLanguage, setDetectedLanguage] = useState<TranslationLanguage | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [usage, setUsage] = useState<TranslationUsage | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const currentPlan = usage?.plan ?? plan;
  const maxCharacters = usage?.maxCharacters ?? getPlanLimits(currentPlan).translation.maxCharacters;
  const freeTranslationLimits = getPlanLimits("free").translation;
  const proTranslationLimits = getPlanLimits("pro").translation;
  const characterCount = useMemo(() => Array.from(sourceText).length, [sourceText]);
  const outputDirection = RTL_LANGUAGES.has(targetLanguage) ? "rtl" : "ltr";

  useEffect(() => {
    if (!handoff) return;
    setSourceText(handoff.text);
    setTranslatedText("");
    setDetectedLanguage(null);
    setConsent(false);
    setError("");
    setNotice(t("translateHandoffReceived"));
    onHandoffConsumed(handoff.id);
  }, [handoff?.id]);

  async function refreshUsage() {
    if (!loggedIn) { setUsage(null); return; }
    setUsageLoading(true);
    try {
      const result = await api<TranslationUsage>("/api/translate");
      setUsage(result);
      setError("");
    } catch (caught) {
      setUsage(null);
      const code = caught instanceof Error ? caught.message : "";
      setError(code === "login_required" ? "" : t(messageKey(caught)));
    } finally { setUsageLoading(false); }
  }

  useEffect(() => { void refreshUsage(); }, [loggedIn, plan]);

  async function translate() {
    if (!loggedIn) { askLogin(); return; }
    if (!sourceText.trim() || busy || !consent) return;
    if (characterCount > maxCharacters) { setError(t("err.translation_too_long")); return; }
    if (usage && !usage.enabled) { setError(t("err.translation_disabled")); return; }
    if (usage && usage.remaining <= 0) { setError(t("err.translation_limit_reached")); return; }
    setBusy(true);
    setError("");
    setNotice("");
    setTranslatedText("");
    setDetectedLanguage(null);
    try {
      const result = await api<TranslationResult>("/api/translate", { text: sourceText, sourceLanguage, targetLanguage });
      setTranslatedText(result.translatedText);
      setDetectedLanguage(result.detectedSourceLanguage);
      setUsage((current) => current ? { ...current, used: result.used, limit: result.limit, remaining: result.remaining, maxCharacters: result.maxCharacters, resetAt: result.resetAt, enabled: true } : current);
      setNotice(t("translateDone"));
    } catch (caught) {
      setError(t(messageKey(caught)));
      if (caught instanceof Error && caught.message === "translation_limit_reached") await refreshUsage();
    } finally {
      setConsent(false);
      setBusy(false);
    }
  }

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(translatedText);
      setNotice(t("translateCopied"));
    } catch { setError(t("translateCopyFailed")); }
  }

  async function downloadResult() {
    if (!translatedText.trim()) return;
    const file = new File([translatedText], `${safeFileName("translated-document")}.txt`, { type: "text/plain;charset=utf-8" });
    await saveBlobToDeviceOrDownload(file, file.name);
    setNotice(t("translateDownloaded"));
  }

  function swapLanguages() {
    if (sourceLanguage === "auto") return;
    setSourceLanguage(targetLanguage);
    setTargetLanguage(sourceLanguage);
    setTranslatedText("");
    setDetectedLanguage(null);
  }

  return (
    <main className="translator-page">
      <header className="translator-hero">
        <div className="translator-hero-icon"><Icon name="languages" size={27}/></div>
        <div className="translator-hero-copy">
          <span className="eyebrow">{t("translateEyebrow")}</span>
          <h2>{t("translateTitle")}</h2>
          <p>{t("translateIntro")}</p>
        </div>
      </header>

      <section className="translator-privacy panel">
        <Icon name="shield" size={19}/>
        <p>{t("translatePrivacy")}</p>
      </section>

      <section className="translator-language-bar panel">
        <label className="field">
          <span>{t("translateSourceLanguage")}</span>
          <select value={sourceLanguage} disabled={busy} onChange={(event) => { setSourceLanguage(event.target.value as "auto" | TranslationLanguage); setTranslatedText(""); setDetectedLanguage(null); }}>
            <option value="auto">{t("translateAutoDetect")}</option>
            {LANGUAGE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{t(option.key)}</option>)}
          </select>
        </label>
        <button type="button" className="translator-swap" disabled={busy || sourceLanguage === "auto"} onClick={swapLanguages} aria-label={t("translateSwap")} title={t("translateSwap")}><Icon name="arrow-left-right" size={19}/></button>
        <label className="field">
          <span>{t("translateTargetLanguage")}</span>
          <select value={targetLanguage} disabled={busy} onChange={(event) => { setTargetLanguage(event.target.value as TranslationLanguage); setTranslatedText(""); }}>
            {LANGUAGE_OPTIONS.map((option) => <option key={option.code} value={option.code}>{t(option.key)}</option>)}
          </select>
        </label>
      </section>

      <section className="translator-grid">
        <article className="translator-pane panel">
          <div className="translator-pane-heading"><strong>{t("translateSourceText")}</strong><span className={characterCount > maxCharacters ? "is-over-limit" : ""}>{characterCount.toLocaleString(lang === "fa" ? "fa-IR" : "en-US")} / {maxCharacters.toLocaleString(lang === "fa" ? "fa-IR" : "en-US")}</span></div>
          <textarea className="translator-textarea" value={sourceText} onChange={(event) => { setSourceText(event.target.value); setTranslatedText(""); setDetectedLanguage(null); setError(""); }} placeholder={t("translateInputPlaceholder")} dir={sourceLanguage === "auto" ? "auto" : RTL_LANGUAGES.has(sourceLanguage) ? "rtl" : "ltr"} disabled={busy}/>
          <div className="translator-pane-footer">
            <button type="button" className="quiet" disabled={!sourceText} onClick={() => { setSourceText(""); setTranslatedText(""); setConsent(false); setError(""); setNotice(""); }}><Icon name="trash" size={15}/>{t("translateClear")}</button>
            <span>{t("translateTextOnly")}</span>
          </div>
        </article>

        <article className="translator-pane panel">
          <div className="translator-pane-heading"><strong>{t("translateResult")}</strong>{detectedLanguage && <span className="translator-detected">{t("translateDetected")}: {t(LANGUAGE_OPTIONS.find((item) => item.code === detectedLanguage)?.key ?? "translateAutoDetect")}</span>}</div>
          <textarea className="translator-textarea" value={translatedText} readOnly placeholder={busy ? t("translateWorking") : t("translateResultPlaceholder")} dir={outputDirection} aria-live="polite"/>
          <div className="translator-pane-footer">
            <button type="button" className="quiet" disabled={!translatedText} onClick={() => void copyResult()}><Icon name="copy" size={15}/>{t("translateCopy")}</button>
            <button type="button" className="quiet" disabled={!translatedText} onClick={() => void downloadResult()}><Icon name="download" size={15}/>{t("translateDownload")}</button>
            <button type="button" className="quiet" disabled={!translatedText} onClick={() => onSendToWord("translated-document.txt", translatedText)}><Icon name="word" size={15}/>{t("translateEditInWord")}</button>
          </div>
        </article>
      </section>

      <section className="translator-actions panel">
        <label className="translator-consent">
          <input type="checkbox" checked={consent} disabled={busy || !sourceText.trim() || !usage?.enabled} onChange={(event) => setConsent(event.target.checked)}/>
          <span>{t("translateConsent")}</span>
        </label>
        <div className="translator-action-row">
          <div className="translator-usage">
            {loggedIn && usage ? <>
              <div className="translator-usage-top">
                <strong>{currentPlan === "pro" ? t("translateProUsage") : t("translateFreeUsage")}</strong>
                <small>{usage.used} / {usage.limit}</small>
              </div>
              <div className="translator-usage-track" role="progressbar" aria-valuemin={0} aria-valuemax={usage.limit} aria-valuenow={Math.min(usage.limit, usage.used)}>
                <div className="translator-usage-fill" style={{ width: `${Math.min(100, usage.limit > 0 ? usage.used / usage.limit * 100 : 0)}%` }} />
              </div>
              <span>{usage.remaining} {t("translateRemaining")}</span>
              {usage.remaining <= 0 && <small>{t("translateResetAt")}: {resetLabel(usage.resetAt, lang)} (UTC)</small>}
            </> : <strong>{!loggedIn ? t("translateLoginRequired") : usageLoading ? t("translateUsageLoading") : t("translateUsageUnavailable")}</strong>}
          </div>
          <button type="button" className="primary translator-submit" disabled={busy || !sourceText.trim() || !consent || !loggedIn || !usage?.enabled || usage.remaining <= 0 || characterCount > maxCharacters} onClick={() => void translate()}>
            <Icon name={busy ? "loader" : "languages"} size={17}/>{busy ? t("translateWorking") : t("translateButton")}
          </button>
        </div>
        {!loggedIn && <div className="translator-login-note"><span>{t("translateLoginRequired")}</span><button type="button" onClick={askLogin}>{t("login")}</button></div>}
        {loggedIn && usage && !usage.enabled && <p className="translator-unavailable" role="status">{t("err.translation_disabled")}</p>}
        {currentPlan === "free" && <button type="button" className="translator-upgrade" onClick={onOpenPlans}>{t("translateUpgrade")}</button>}
        {error && <p className="error" role="alert">{error}</p>}
        {notice && <p className="translator-notice" role="status">{notice}</p>}
        <p className="translator-footnote">{t("translateQuotaNote")} {t("planFree")}: {freeTranslationLimits.requestsPerDay.toLocaleString(lang === "fa" ? "fa-IR" : "en-US")}/day · {freeTranslationLimits.maxCharacters.toLocaleString(lang === "fa" ? "fa-IR" : "en-US")} chars; Pro: {proTranslationLimits.requestsPerDay.toLocaleString(lang === "fa" ? "fa-IR" : "en-US")}/day · {proTranslationLimits.maxCharacters.toLocaleString(lang === "fa" ? "fa-IR" : "en-US")} chars.</p>
      </section>
    </main>
  );
}

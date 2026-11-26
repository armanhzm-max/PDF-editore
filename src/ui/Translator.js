import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from "react";
import { api } from "../core/permissions";
import { getPlanLimits } from "../core/entitlements.js";
import { saveBlobToDeviceOrDownload } from "../core/device-folder";
import { Icon } from "./icons";
const LANGUAGE_OPTIONS = [
    { code: "fa", key: "translateLangFa" }, { code: "en", key: "translateLangEn" },
    { code: "ar", key: "translateLangAr" }, { code: "fr", key: "translateLangFr" },
    { code: "de", key: "translateLangDe" }, { code: "es", key: "translateLangEs" },
    { code: "it", key: "translateLangIt" }, { code: "tr", key: "translateLangTr" },
    { code: "ru", key: "translateLangRu" }, { code: "zh", key: "translateLangZh" },
    { code: "ja", key: "translateLangJa" },
];
const RTL_LANGUAGES = new Set(["fa", "ar"]);
function messageKey(error) {
    const code = error instanceof Error ? error.message : "";
    if (["translation_disabled", "translation_too_long", "translation_limit_reached", "translation_unsupported_language", "translation_same_language", "translation_provider_busy", "translation_provider_failed", "translation_timeout", "translation_response_truncated", "login_required", "too_many", "invalid_input"].includes(code))
        return `err.${code}`;
    return "err.translation_provider_failed";
}
function resetLabel(resetAt, lang) {
    const date = new Date(resetAt * 1000);
    return new Intl.DateTimeFormat(lang === "fa" ? "fa-IR" : "en-US", { hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(date);
}
function safeFileName(value) {
    const clean = value.replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 70);
    return clean || "translation";
}
export default function Translator({ t, lang, plan, loggedIn, askLogin, handoff, onHandoffConsumed, onSendToWord, onOpenPlans }) {
    const [sourceText, setSourceText] = useState("");
    const [sourceLanguage, setSourceLanguage] = useState("auto");
    const [targetLanguage, setTargetLanguage] = useState(lang === "fa" ? "en" : "fa");
    const [translatedText, setTranslatedText] = useState("");
    const [detectedLanguage, setDetectedLanguage] = useState(null);
    const [consent, setConsent] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [usage, setUsage] = useState(null);
    const [usageLoading, setUsageLoading] = useState(false);
    const currentPlan = usage?.plan ?? plan;
    const maxCharacters = usage?.maxCharacters ?? getPlanLimits(currentPlan).translation.maxCharacters;
    const freeTranslationLimits = getPlanLimits("free").translation;
    const proTranslationLimits = getPlanLimits("pro").translation;
    const characterCount = useMemo(() => Array.from(sourceText).length, [sourceText]);
    const outputDirection = RTL_LANGUAGES.has(targetLanguage) ? "rtl" : "ltr";
    useEffect(() => {
        if (!handoff)
            return;
        setSourceText(handoff.text);
        setTranslatedText("");
        setDetectedLanguage(null);
        setConsent(false);
        setError("");
        setNotice(t("translateHandoffReceived"));
        onHandoffConsumed(handoff.id);
    }, [handoff?.id]);
    async function refreshUsage() {
        if (!loggedIn) {
            setUsage(null);
            return;
        }
        setUsageLoading(true);
        try {
            const result = await api("/api/translate");
            setUsage(result);
            setError("");
        }
        catch (caught) {
            setUsage(null);
            const code = caught instanceof Error ? caught.message : "";
            setError(code === "login_required" ? "" : t(messageKey(caught)));
        }
        finally {
            setUsageLoading(false);
        }
    }
    useEffect(() => { void refreshUsage(); }, [loggedIn, plan]);
    async function translate() {
        if (!loggedIn) {
            askLogin();
            return;
        }
        if (!sourceText.trim() || busy || !consent)
            return;
        if (characterCount > maxCharacters) {
            setError(t("err.translation_too_long"));
            return;
        }
        if (usage && !usage.enabled) {
            setError(t("err.translation_disabled"));
            return;
        }
        if (usage && usage.remaining <= 0) {
            setError(t("err.translation_limit_reached"));
            return;
        }
        setBusy(true);
        setError("");
        setNotice("");
        setTranslatedText("");
        setDetectedLanguage(null);
        try {
            const result = await api("/api/translate", { text: sourceText, sourceLanguage, targetLanguage });
            setTranslatedText(result.translatedText);
            setDetectedLanguage(result.detectedSourceLanguage);
            setUsage((current) => current ? { ...current, used: result.used, limit: result.limit, remaining: result.remaining, maxCharacters: result.maxCharacters, resetAt: result.resetAt, enabled: true } : current);
            setNotice(t("translateDone"));
        }
        catch (caught) {
            setError(t(messageKey(caught)));
            if (caught instanceof Error && caught.message === "translation_limit_reached")
                await refreshUsage();
        }
        finally {
            setConsent(false);
            setBusy(false);
        }
    }
    async function copyResult() {
        try {
            await navigator.clipboard.writeText(translatedText);
            setNotice(t("translateCopied"));
        }
        catch {
            setError(t("translateCopyFailed"));
        }
    }
    async function downloadResult() {
        if (!translatedText.trim())
            return;
        const file = new File([translatedText], `${safeFileName("translated-document")}.txt`, { type: "text/plain;charset=utf-8" });
        await saveBlobToDeviceOrDownload(file, file.name);
        setNotice(t("translateDownloaded"));
    }
    function swapLanguages() {
        if (sourceLanguage === "auto")
            return;
        setSourceLanguage(targetLanguage);
        setTargetLanguage(sourceLanguage);
        setTranslatedText("");
        setDetectedLanguage(null);
    }
    return (_jsxs("main", { className: "translator-page", children: [_jsxs("header", { className: "translator-hero", children: [_jsx("div", { className: "translator-hero-icon", children: _jsx(Icon, { name: "languages", size: 27 }) }), _jsxs("div", { className: "translator-hero-copy", children: [_jsx("span", { className: "eyebrow", children: t("translateEyebrow") }), _jsx("h2", { children: t("translateTitle") }), _jsx("p", { children: t("translateIntro") })] })] }), _jsxs("section", { className: "translator-privacy panel", children: [_jsx(Icon, { name: "shield", size: 19 }), _jsx("p", { children: t("translatePrivacy") })] }), _jsxs("section", { className: "translator-language-bar panel", children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: t("translateSourceLanguage") }), _jsxs("select", { value: sourceLanguage, disabled: busy, onChange: (event) => { setSourceLanguage(event.target.value); setTranslatedText(""); setDetectedLanguage(null); }, children: [_jsx("option", { value: "auto", children: t("translateAutoDetect") }), LANGUAGE_OPTIONS.map((option) => _jsx("option", { value: option.code, children: t(option.key) }, option.code))] })] }), _jsx("button", { type: "button", className: "translator-swap", disabled: busy || sourceLanguage === "auto", onClick: swapLanguages, "aria-label": t("translateSwap"), title: t("translateSwap"), children: _jsx(Icon, { name: "arrow-left-right", size: 19 }) }), _jsxs("label", { className: "field", children: [_jsx("span", { children: t("translateTargetLanguage") }), _jsx("select", { value: targetLanguage, disabled: busy, onChange: (event) => { setTargetLanguage(event.target.value); setTranslatedText(""); }, children: LANGUAGE_OPTIONS.map((option) => _jsx("option", { value: option.code, children: t(option.key) }, option.code)) })] })] }), _jsxs("section", { className: "translator-grid", children: [_jsxs("article", { className: "translator-pane panel", children: [_jsxs("div", { className: "translator-pane-heading", children: [_jsx("strong", { children: t("translateSourceText") }), _jsxs("span", { className: characterCount > maxCharacters ? "is-over-limit" : "", children: [characterCount.toLocaleString(lang === "fa" ? "fa-IR" : "en-US"), " / ", maxCharacters.toLocaleString(lang === "fa" ? "fa-IR" : "en-US")] })] }), _jsx("textarea", { className: "translator-textarea", value: sourceText, onChange: (event) => { setSourceText(event.target.value); setTranslatedText(""); setDetectedLanguage(null); setError(""); }, placeholder: t("translateInputPlaceholder"), dir: sourceLanguage === "auto" ? "auto" : RTL_LANGUAGES.has(sourceLanguage) ? "rtl" : "ltr", disabled: busy }), _jsxs("div", { className: "translator-pane-footer", children: [_jsxs("button", { type: "button", className: "quiet", disabled: !sourceText, onClick: () => { setSourceText(""); setTranslatedText(""); setConsent(false); setError(""); setNotice(""); }, children: [_jsx(Icon, { name: "trash", size: 15 }), t("translateClear")] }), _jsx("span", { children: t("translateTextOnly") })] })] }), _jsxs("article", { className: "translator-pane panel", children: [_jsxs("div", { className: "translator-pane-heading", children: [_jsx("strong", { children: t("translateResult") }), detectedLanguage && _jsxs("span", { className: "translator-detected", children: [t("translateDetected"), ": ", t(LANGUAGE_OPTIONS.find((item) => item.code === detectedLanguage)?.key ?? "translateAutoDetect")] })] }), _jsx("textarea", { className: "translator-textarea", value: translatedText, readOnly: true, placeholder: busy ? t("translateWorking") : t("translateResultPlaceholder"), dir: outputDirection, "aria-live": "polite" }), _jsxs("div", { className: "translator-pane-footer", children: [_jsxs("button", { type: "button", className: "quiet", disabled: !translatedText, onClick: () => void copyResult(), children: [_jsx(Icon, { name: "copy", size: 15 }), t("translateCopy")] }), _jsxs("button", { type: "button", className: "quiet", disabled: !translatedText, onClick: () => void downloadResult(), children: [_jsx(Icon, { name: "download", size: 15 }), t("translateDownload")] }), _jsxs("button", { type: "button", className: "quiet", disabled: !translatedText, onClick: () => onSendToWord("translated-document.txt", translatedText), children: [_jsx(Icon, { name: "word", size: 15 }), t("translateEditInWord")] })] })] })] }), _jsxs("section", { className: "translator-actions panel", children: [_jsxs("label", { className: "translator-consent", children: [_jsx("input", { type: "checkbox", checked: consent, disabled: busy || !sourceText.trim() || !usage?.enabled, onChange: (event) => setConsent(event.target.checked) }), _jsx("span", { children: t("translateConsent") })] }), _jsxs("div", { className: "translator-action-row", children: [_jsx("div", { className: "translator-usage", children: loggedIn && usage ? _jsxs(_Fragment, { children: [_jsxs("div", { className: "translator-usage-top", children: [_jsx("strong", { children: currentPlan === "pro" ? t("translateProUsage") : t("translateFreeUsage") }), _jsxs("small", { children: [usage.used, " / ", usage.limit] })] }), _jsx("div", { className: "translator-usage-track", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": usage.limit, "aria-valuenow": Math.min(usage.limit, usage.used), children: _jsx("div", { className: "translator-usage-fill", style: { width: `${Math.min(100, usage.limit > 0 ? usage.used / usage.limit * 100 : 0)}%` } }) }), _jsxs("span", { children: [usage.remaining, " ", t("translateRemaining")] }), usage.remaining <= 0 && _jsxs("small", { children: [t("translateResetAt"), ": ", resetLabel(usage.resetAt, lang), " (UTC)"] })] }) : _jsx("strong", { children: !loggedIn ? t("translateLoginRequired") : usageLoading ? t("translateUsageLoading") : t("translateUsageUnavailable") }) }), _jsxs("button", { type: "button", className: "primary translator-submit", disabled: busy || !sourceText.trim() || !consent || !loggedIn || !usage?.enabled || usage.remaining <= 0 || characterCount > maxCharacters, onClick: () => void translate(), children: [_jsx(Icon, { name: busy ? "loader" : "languages", size: 17 }), busy ? t("translateWorking") : t("translateButton")] })] }), !loggedIn && _jsxs("div", { className: "translator-login-note", children: [_jsx("span", { children: t("translateLoginRequired") }), _jsx("button", { type: "button", onClick: askLogin, children: t("login") })] }), loggedIn && usage && !usage.enabled && _jsx("p", { className: "translator-unavailable", role: "status", children: t("err.translation_disabled") }), currentPlan === "free" && _jsx("button", { type: "button", className: "translator-upgrade", onClick: onOpenPlans, children: t("translateUpgrade") }), error && _jsx("p", { className: "error", role: "alert", children: error }), notice && _jsx("p", { className: "translator-notice", role: "status", children: notice }), _jsxs("p", { className: "translator-footnote", children: [t("translateQuotaNote"), " ", t("planFree"), ": ", freeTranslationLimits.requestsPerDay.toLocaleString(lang === "fa" ? "fa-IR" : "en-US"), "/day \u00B7 ", freeTranslationLimits.maxCharacters.toLocaleString(lang === "fa" ? "fa-IR" : "en-US"), " chars; Pro: ", proTranslationLimits.requestsPerDay.toLocaleString(lang === "fa" ? "fa-IR" : "en-US"), "/day \u00B7 ", proTranslationLimits.maxCharacters.toLocaleString(lang === "fa" ? "fa-IR" : "en-US"), " chars."] })] })] }));
}

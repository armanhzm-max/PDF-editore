import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { api, setToken } from "../core/permissions";
import { Icon } from "./icons";
import { getPlanLimits } from "../core/entitlements.js";
const errMsg = (t, e) => t("err." + e.message);
// Network failures surface as TypeError ("Failed to fetch"); unknown codes fall back to a friendly message.
function humanError(t, error) {
    const code = error instanceof Error ? error.message : "";
    if (error instanceof TypeError || /fetch|network/i.test(code))
        return t("err.network_unreachable");
    const mapped = t("err." + code);
    return mapped !== "err." + code ? mapped : t("authGenericError");
}
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const countChars = (value) => Array.from(value).length;
const STRENGTH_KEYS = ["strengthWeak", "strengthWeak", "strengthFair", "strengthGood", "strengthStrong"];
// 0 = too short/empty · 4 = strongest. Guidance only; the server keeps enforcing 12–128 characters.
function passwordScore(value) {
    const length = countChars(value);
    if (!value || length < 12)
        return 0;
    let score = 1;
    if (/[a-z]/.test(value) && /[A-Z]/.test(value))
        score += 1;
    if (/\d/.test(value))
        score += 1;
    if (/[^\w\s]/.test(value) || length >= 16)
        score += 1;
    return Math.min(score, 4);
}
export function AuthForm({ t, onDone, mode, onModeChange, onClose, }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [busy, setBusy] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [touched, setTouched] = useState({});
    const [capsLock, setCapsLock] = useState(false);
    const [msg, setMsg] = useState(null);
    const emailRef = useRef(null);
    const passwordRef = useRef(null);
    const cardRef = useRef(null);
    const closeRef = useRef(onClose);
    closeRef.current = onClose;
    const emailValue = email.trim();
    const emailError = !emailValue ? t("authEmailRequired") : !EMAIL_PATTERN.test(emailValue) ? t("authInvalidEmail") : "";
    const passwordLength = countChars(password);
    const passwordError = !password ? t("passwordRequired") : passwordLength < 12 ? t("passwordTooShort") : passwordLength > 128 ? t("passwordTooLong") : "";
    const confirmError = password !== confirmPassword ? t("passwordMismatch") : "";
    const showEmailError = (submitted || touched.email) && !!emailError;
    const showPasswordError = (submitted || touched.password) && !!passwordError;
    const showConfirmError = (submitted || touched.confirm) && !!confirmError;
    const formValid = !emailError && !passwordError && (mode !== "register" || !confirmError);
    const strength = passwordScore(password);
    // ESC closes the dialog, Tab stays inside it, and background scrolling is locked while open.
    useEffect(() => {
        const onKey = (event) => {
            if (event.key === "Escape") {
                closeRef.current();
                return;
            }
            if (event.key !== "Tab")
                return;
            const root = cardRef.current;
            if (!root)
                return;
            const focusable = Array.from(root.querySelectorAll("button:not(:disabled), input:not(:disabled), a[href], [tabindex]:not([tabindex='-1'])"))
                .filter((element) => element.offsetParent !== null || element === document.activeElement);
            if (!focusable.length)
                return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (!active || !root.contains(active)) {
                event.preventDefault();
                first.focus();
                return;
            }
            if (event.shiftKey && active === first) {
                event.preventDefault();
                last.focus();
            }
            else if (!event.shiftKey && active === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener("keydown", onKey);
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; };
    }, []);
    function markTouched(field) { setTouched((current) => ({ ...current, [field]: true })); }
    function changeMode(next) {
        if (next === mode || busy)
            return;
        onModeChange(next);
        setPassword("");
        setConfirmPassword("");
        setShowPassword(false);
        setCapsLock(false);
        setMsg(null);
        setSubmitted(false);
        setTouched({});
    }
    async function submit() {
        if (busy)
            return;
        setSubmitted(true);
        if (!formValid) {
            setMsg(null);
            if (emailError)
                emailRef.current?.focus();
            else
                passwordRef.current?.focus();
            return;
        }
        setBusy(true);
        setMsg(null);
        try {
            const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
            const result = await api(path, { email: emailValue.toLowerCase(), password });
            setToken(result.token);
            onDone();
        }
        catch (error) {
            const code = error instanceof Error ? error.message : "";
            setMsg({ tone: "error", text: humanError(t, error), code });
            if (code === "invalid_credentials") {
                setPassword("");
                setConfirmPassword("");
                window.setTimeout(() => passwordRef.current?.focus(), 0);
            }
        }
        finally {
            setBusy(false);
        }
    }
    return (_jsx("div", { className: "auth-overlay", onClick: (event) => { if (event.target === event.currentTarget)
            onClose(); }, children: _jsxs("section", { className: "auth-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "auth-title", ref: cardRef, onClick: (event) => event.stopPropagation(), children: [_jsx("button", { type: "button", className: "auth-close", onClick: onClose, "aria-label": t("close"), title: t("close"), children: "\u00D7" }), _jsxs("header", { className: "auth-card-heading", children: [_jsx("span", { className: "auth-brand", "aria-hidden": "true", children: _jsx("img", { src: "/favicon.svg", alt: "", width: "26", height: "26" }) }), _jsx("h2", { id: "auth-title", children: t(mode === "register" ? "authRegisterTitle" : "authLoginTitle") }), _jsx("p", { children: t(mode === "register" ? "authRegisterHint" : "authLoginHint") })] }), _jsxs("div", { className: "auth-tabs", role: "tablist", "aria-label": t("authTabsLabel"), children: [_jsx("button", { type: "button", role: "tab", id: "auth-tab-login", "aria-controls": "auth-panel", "aria-selected": mode === "login", className: mode === "login" ? "active" : "", onClick: () => changeMode("login"), disabled: busy, children: t("login") }), _jsx("button", { type: "button", role: "tab", id: "auth-tab-register", "aria-controls": "auth-panel", "aria-selected": mode === "register", className: mode === "register" ? "active" : "", onClick: () => changeMode("register"), disabled: busy, children: t("createAccount") })] }), _jsxs("form", { id: "auth-panel", className: "auth-form", role: "tabpanel", "aria-labelledby": mode === "login" ? "auth-tab-login" : "auth-tab-register", noValidate: true, onSubmit: (event) => { event.preventDefault(); void submit(); }, children: [_jsxs("label", { className: "field auth-field", "data-invalid": showEmailError || undefined, children: [_jsx("span", { className: "auth-field-label", children: t("email") }), _jsxs("span", { className: "auth-input-wrap", children: [_jsx("span", { className: "auth-input-icon", "aria-hidden": "true", children: _jsx(Icon, { name: "mail", size: 17 }) }), _jsx("input", { ref: emailRef, type: "email", name: "email", autoComplete: "email", maxLength: 120, placeholder: "name@example.com", value: email, autoFocus: true, disabled: busy, dir: "ltr", required: true, "aria-invalid": showEmailError || undefined, onChange: (event) => { setEmail(event.target.value); setMsg(null); }, onBlur: () => markTouched("email") })] }), showEmailError && _jsxs("span", { className: "auth-field-error", children: [_jsx(Icon, { name: "alert-triangle", size: 13 }), emailError] })] }), _jsxs("label", { className: "field auth-field", "data-invalid": showPasswordError || undefined, children: [_jsx("span", { className: "auth-field-label", children: t("password") }), _jsxs("span", { className: "auth-input-wrap", children: [_jsx("span", { className: "auth-input-icon", "aria-hidden": "true", children: _jsx(Icon, { name: "lock", size: 17 }) }), _jsx("input", { ref: passwordRef, type: showPassword ? "text" : "password", name: "password", autoComplete: mode === "register" ? "new-password" : "current-password", minLength: 12, maxLength: 128, value: password, dir: "ltr", disabled: busy, required: true, "aria-invalid": showPasswordError || undefined, onChange: (event) => { setPassword(event.target.value); setMsg(null); }, onKeyUp: (event) => setCapsLock(event.getModifierState("CapsLock")), onBlur: () => { markTouched("password"); setCapsLock(false); } }), _jsx("button", { type: "button", className: "auth-eye", onClick: () => setShowPassword((value) => !value), disabled: busy, "aria-label": t(showPassword ? "hidePassword" : "showPassword"), title: t(showPassword ? "hidePassword" : "showPassword"), children: _jsx(Icon, { name: showPassword ? "eye-off" : "eye", size: 17 }) })] }), capsLock && _jsxs("span", { className: "auth-caps", children: [_jsx(Icon, { name: "alert-triangle", size: 13 }), t("capsLockOn")] }), mode === "register" && _jsx("span", { className: "auth-hint", children: t("passwordRequirement") }), showPasswordError && _jsxs("span", { className: "auth-field-error", children: [_jsx(Icon, { name: "alert-triangle", size: 13 }), passwordError] })] }), mode === "register" && password && (_jsxs("div", { className: "auth-strength", "data-level": strength, children: [_jsxs("div", { className: "auth-strength-bars", "aria-hidden": "true", children: [_jsx("i", {}), _jsx("i", {}), _jsx("i", {}), _jsx("i", {})] }), _jsxs("span", { className: "auth-strength-label", children: [t("passwordStrength"), ": ", _jsx("strong", { children: t(STRENGTH_KEYS[strength]) })] })] })), mode === "register" && (_jsxs("label", { className: "field auth-field", "data-invalid": showConfirmError || undefined, children: [_jsx("span", { className: "auth-field-label", children: t("confirmPassword") }), _jsxs("span", { className: "auth-input-wrap", children: [_jsx("span", { className: "auth-input-icon", "aria-hidden": "true", children: _jsx(Icon, { name: "lock", size: 17 }) }), _jsx("input", { type: showPassword ? "text" : "password", name: "confirm-password", autoComplete: "new-password", minLength: 12, maxLength: 128, value: confirmPassword, dir: "ltr", disabled: busy, required: true, "aria-invalid": showConfirmError || undefined, onChange: (event) => { setConfirmPassword(event.target.value); setMsg(null); }, onBlur: () => markTouched("confirm") }), confirmPassword && !confirmError && _jsx("span", { className: "auth-input-ok", "aria-hidden": "true", children: _jsx(Icon, { name: "check", size: 16 }) })] }), showConfirmError && _jsxs("span", { className: "auth-field-error", children: [_jsx(Icon, { name: "alert-triangle", size: 13 }), confirmError] })] })), mode === "register" && _jsxs("p", { className: "auth-verification-note", children: [_jsx(Icon, { name: "info", size: 15 }), _jsx("span", { children: t("authUnverifiedSignupNote") })] }), _jsxs("button", { className: "primary auth-submit", type: "submit", disabled: busy, children: [busy && _jsx("span", { className: "auth-spinner", "aria-hidden": "true" }), busy ? t("processing") : t(mode === "register" ? "createAccount" : "login")] })] }), msg && (_jsxs("div", { className: `auth-message ${msg.tone === "error" ? "is-error" : "is-success"}`, role: "status", "aria-live": "polite", children: [_jsx(Icon, { name: msg.tone === "error" ? "alert-triangle" : "check", size: 16 }), _jsx("span", { children: msg.text }), msg.code === "account_exists" && (_jsx("button", { type: "button", className: "link auth-msg-action", onClick: () => changeMode("login"), children: t("login") }))] })), _jsxs("small", { className: "auth-consent", children: [t("consent"), " ", _jsx("a", { href: "#terms", onClick: onClose, children: t("termsLink") }), " \u00B7 ", _jsx("a", { href: "#privacy", onClick: onClose, children: t("privacyLink") })] })] }) }));
}
export function LegacyPasswordSetup({ t, onDone }) {
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    async function save() {
        if (Array.from(password).length < 12 || Array.from(password).length > 128)
            return;
        if (password !== confirmPassword) {
            setMessage(t("passwordMismatch"));
            return;
        }
        setBusy(true);
        setMessage("");
        try {
            await api("/api/auth/set-password", { password });
            onDone();
        }
        catch (error) {
            setMessage(errMsg(t, error));
        }
        finally {
            setBusy(false);
        }
    }
    return _jsxs("section", { className: "auth-card legacy-password-setup", children: [_jsx("h2", { children: t("legacyPasswordTitle") }), _jsx("p", { children: t("legacyPasswordHint") }), _jsxs("label", { className: "field", children: [_jsx("span", { children: t("password") }), _jsx("input", { type: "password", autoComplete: "new-password", minLength: 12, maxLength: 128, value: password, onChange: (event) => setPassword(event.target.value), dir: "ltr" })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: t("confirmPassword") }), _jsx("input", { type: "password", autoComplete: "new-password", minLength: 12, maxLength: 128, value: confirmPassword, onChange: (event) => setConfirmPassword(event.target.value), dir: "ltr" })] }), _jsx("button", { className: "primary", type: "button", disabled: busy || Array.from(password).length < 12 || password !== confirmPassword, onClick: () => void save(), children: busy ? t("processing") : t("savePassword") }), message && _jsx("p", { className: "auth-message", role: "status", children: message })] });
}
export function Pricing({ t, lang, me, onLogin, onRefresh }) {
    const fa = lang === "fa";
    const [msg, setMsg] = useState("");
    const [refreshing, setRefreshing] = useState(false);
    const freeTranslation = getPlanLimits("free").translation;
    const proTranslation = getPlanLimits("pro").translation;
    async function refreshStatus() {
        if (!onRefresh)
            return;
        setRefreshing(true);
        setMsg("");
        try {
            const ok = await onRefresh();
            setMsg(ok ? (fa ? "وضعیت اشتراک از سرور به‌روزرسانی شد." : "Subscription status refreshed from the server.") : (fa ? "برای بررسی اشتراک ابتدا وارد حساب خود شوید یا اتصال سرور را بررسی کنید." : "Sign in or check the server connection to refresh your plan."));
        }
        finally {
            setRefreshing(false);
        }
    }
    async function go(path, body) {
        try {
            location.href = (await api(path, body)).url;
        }
        catch (e) {
            setMsg(errMsg(t, e));
        }
    }
    const rows = [
        { group: fa ? "ادغام PDF" : "Merge PDF", values: ["۳ فایل", "۳۰ فایل"] },
        { group: fa ? "تبدیل تصاویر به PDF" : "Images to PDF", values: ["۵ تصویر", "۳۰ تصویر"] },
        { group: fa ? "تبدیل فرمت تصویر" : "Image conversion", values: ["۱ تصویر در هر اجرا", "۲۰ تصویر در هر اجرا"] },
        { group: fa ? "فشرده‌سازی PDF" : "PDF compression", values: ["۱ فایل در هر اجرا", "۲۰ فایل در هر اجرا"] },
        { group: fa ? "تقسیم PDF" : "Split PDF", values: ["۱ فایل در هر اجرا", "۲۰ فایل در هر اجرا"] },
        { group: fa ? "حداکثر حجم هر فایل" : "Maximum file size", values: ["۲۵ مگابایت / 25 MB", "۵۰ مگابایت / 50 MB"] },
        { group: fa ? "حجم مجموع هر عملیات" : "Combined size per operation", values: ["۵۰ مگابایت / 50 MB", "۱۰۰ مگابایت / 100 MB"] },
        { group: fa ? "حداکثر ابعاد تصویر" : "Maximum image dimensions", values: ["۲۰ مگاپیکسل برای هر تصویر؛ ۴۰ مگاپیکسل مجموع", "۳۲ مگاپیکسل برای هر تصویر؛ ۸۰ مگاپیکسل مجموع"] },
        { group: fa ? "سقف عمومی صفحات PDF" : "General PDF page ceiling", values: ["۱۰۰ صفحه در هر فایل؛ ۲۰۰ صفحه مجموع", "۳۰۰ صفحه در هر فایل؛ ۵۰۰ صفحه مجموع"] },
        { group: fa ? "Scan Center (اسکن چندصفحه‌ای)" : "Scan Center (multi-page scanning)", values: ["۵ صفحه در هر کار", "۲۰ صفحه در هر کار"] },
        { group: fa ? "فشرده‌سازی و تقسیم PDF (سقف صفحات)" : "PDF compression and split (page ceiling)", values: ["فشرده‌سازی: ۱۰۰ صفحه؛ تقسیم: ۵۰ صفحه", "فشرده‌سازی و تقسیم: ۳۰۰ صفحه"] },
        { group: fa ? "OCR PDF در ابزار مستقل" : "Single-PDF OCR tool", values: ["۱ فایل؛ حداکثر ۳۰ صفحه", "۱ فایل؛ حداکثر ۱۰۰ صفحه"] },
        { group: fa ? "استخراج متن PDF با AI (اتصال فعلاً خاموش)" : "AI PDF text extraction (AI currently disabled)", values: ["۱ فایل؛ ۵۰ صفحه", "۱ فایل؛ ۳۰۰ صفحه"] },
        { group: fa ? "ویرایش PDF" : "PDF Editor", values: ["۵۰ صفحه و فایل ۲۵ مگابایتی", "۳۰۰ صفحه و فایل ۵۰ مگابایتی"] },
        { group: fa ? "Word Workspace" : "Word Workspace", values: ["۲۰ مگابایت فایل؛ ۱۰۰ مگابایت محتوای بازشده؛ ۱٫۵ میلیون نویسه", "۴۰ مگابایت فایل؛ ۲۰۰ مگابایت محتوای بازشده؛ ۴ میلیون نویسه"] },
        { group: fa ? "Excel Workspace" : "Excel Workspace", values: ["۱۵ مگابایت فایل؛ ۸۰ مگابایت محتوای بازشده؛ ۵۰۰ × ۱۰۰", "۳۰ مگابایت فایل؛ ۱۶۰ مگابایت محتوای بازشده؛ ۵٬۰۰۰ × ۲۰۰"] },
        { group: fa ? "PowerPoint Workspace" : "PowerPoint Workspace", values: ["۲۰ مگابایت فایل؛ ۳۰ اسلاید؛ ۱۲٬۰۰۰ نویسه در هر اسلاید", "۵۰ مگابایت فایل؛ ۱۲۰ اسلاید؛ ۲۴٬۰۰۰ نویسه در هر اسلاید"] },
        { group: fa ? "فضای کاری محلی" : "Local workspace", values: ["۱۰ پیش‌نویس؛ ۱۵ مگابایت مجموع؛ ۲ مگابایت برای هر مورد", "۴۰ پیش‌نویس؛ ۶۰ مگابایت مجموع؛ ۴ مگابایت برای هر مورد"] },
        { group: fa ? "حجم فایل پشتیبان قابل بازیابی" : "Restorable backup size", values: ["۲۵ مگابایت / 25 MB", "۲۵ مگابایت / 25 MB"] },
        { group: fa ? "AI Documents" : "AI Documents", values: ["۳ سند؛ ۱۵ مگابایت برای هر سند و مجموع؛ ۱۰۰ صفحه PDF؛ ۲۴ هزار نویسه زمینه", "۲۰ سند؛ ۵۰ مگابایت برای هر سند؛ ۶۰ مگابایت مجموع؛ ۳۰۰ صفحه PDF؛ ۷۲ هزار نویسه زمینه"] },
        { group: fa ? "درخواست‌های AI در روز (پس از فعال‌سازی)" : "AI requests/day (when enabled)", values: ["۳", "۲۰۰"] },
        { group: fa ? "درخواست‌های دستیار در روز (پس از فعال‌سازی)" : "Assistant requests/day (when enabled)", values: ["۱۰", "۳۰۰"] },
        { group: fa ? "ترجمه در روز (پس از پیکربندی سرویس ترجمه)" : "Translations/day (when translation is configured)", values: [`${freeTranslation.requestsPerDay} / ${freeTranslation.maxCharacters.toLocaleString("en-US")} ${fa ? "نویسه" : "characters"}`, `${proTranslation.requestsPerDay} / ${proTranslation.maxCharacters.toLocaleString("en-US")} ${fa ? "نویسه" : "characters"}`] },
    ];
    return (_jsxs("section", { className: "plans-page", id: "plans", children: [_jsxs("div", { className: "plans-heading", children: [_jsx("span", { className: "plans-eyebrow", children: fa ? "پلن‌ها و محدودیت‌ها" : "PLANS & LIMITS" }), _jsx("h2", { children: fa ? "کدام پلن برای شما مناسب‌تر است؟" : "Choose the plan that fits your workflow" }), _jsx("p", { children: fa ? "همه ابزارهای پایه در پلن رایگان در دسترس‌اند؛ Pro ظرفیت بیشتری برای کارهای سنگین و دسته‌ای فراهم می‌کند." : "All core tools are available on Free. Pro raises the limits for larger and batch workflows." })] }), _jsxs("div", { className: "plans", children: [_jsxs("div", { className: `plan ${me?.plan !== "pro" ? "plan-current" : ""}`, children: [_jsxs("div", { className: "plan-title-row", children: [_jsxs("h3", { className: "ph", children: [_jsx(Icon, { name: "device", size: 20 }), t("planFree")] }), me?.plan !== "pro" && _jsx("span", { className: "plan-current-badge", children: fa ? "پلن فعلی" : "Current plan" })] }), _jsx("div", { className: "plan-price", children: fa ? "رایگان" : "Free" }), _jsx("p", { children: fa ? "برای استفاده روزمره و شروع کار با همه فضاهای کاری." : "For everyday use and getting started with every workspace." }), _jsxs("ul", { className: "plan-highlights", children: [_jsx("li", { children: fa ? "دسترسی به تمام ابزارهای پایه" : "Access to all core tools" }), _jsx("li", { children: fa ? "پردازش محلی و ذخیره روی دستگاه" : "Local processing and device storage" }), _jsx("li", { children: fa ? "سقف کمتر برای فایل، صفحه و پروژه" : "Lower file, page and project limits" })] }), me?.plan !== "pro" && _jsx("span", { className: "plan-selected-note", children: fa ? "پلن رایگان شما فعال است" : "Your Free plan is active" })] }), _jsxs("div", { className: `plan pro ${me?.plan === "pro" ? "plan-current" : ""}`, children: [_jsxs("div", { className: "plan-title-row", children: [_jsxs("h3", { className: "ph", children: [_jsx(Icon, { name: "crown", size: 20 }), t("pro")] }), _jsx("span", { className: "plan-popular-badge", children: fa ? "ظرفیت بالاتر" : "Higher limits" })] }), _jsx("div", { className: "plan-price", children: "Pro" }), _jsx("p", { children: fa ? "برای کاربران حرفه‌ای، اسناد بزرگ‌تر و پردازش دسته‌ای." : "For power users, larger documents and batch processing." }), _jsxs("ul", { className: "plan-highlights", children: [_jsx("li", { children: fa ? "سقف بالاتر در تمام فضاهای کاری" : "Higher limits across all workspaces" }), _jsx("li", { children: fa ? "پروژه‌ها و پیش‌نویس‌های محلی بیشتر" : "More local projects and drafts" }), _jsx("li", { children: fa ? "سهمیه بیشتر AI پس از فعال‌سازی اتصال" : "Higher AI quotas after AI is enabled" })] }), me?.plan === "pro" ? _jsxs(_Fragment, { children: [_jsx("span", { className: "plan-selected-note", children: fa ? "اشتراک حرفه‌ای فعال است" : "Pro is active" }), _jsxs("p", { children: [t("proUntil"), " ", me.planUntil ? new Date(me.planUntil * 1000).toLocaleDateString(lang) : (fa ? "—" : "—")] })] }) : me ? (_jsxs("div", { className: "stack plan-actions", children: [_jsxs("button", { className: "primary", onClick: () => go("/api/billing/checkout", { provider: "stripe" }), children: [_jsx(Icon, { name: "card", size: 16 }), t("payCard")] }), lang === "fa" && _jsx("button", { onClick: () => go("/api/billing/checkout", { provider: "zarinpal" }), children: t("payZarin") })] })) : _jsx("button", { className: "primary", onClick: onLogin, children: fa ? "ورود برای خرید اشتراک" : "Sign in to subscribe" }), me?.hasStripe && _jsxs("button", { onClick: () => go("/api/billing/portal", {}), children: [_jsx(Icon, { name: "card", size: 16 }), t("manage")] }), _jsx("small", { className: "muted", children: fa ? "مبلغ نهایی توسط درگاه پرداخت نمایش داده می‌شود؛ زرین‌پال ۳۰ روزه و Stripe طبق دوره قیمت تنظیم‌شده است." : "The payment provider shows the configured price. Zarinpal grants 30 days; Stripe follows its configured billing period." })] })] }), _jsxs("div", { className: "plan-refresh-row", children: [_jsx("span", { className: "muted small", children: fa ? "وضعیت اشتراک از سرور خوانده می‌شود." : "Subscription status is verified by the server." }), _jsx("button", { type: "button", onClick: refreshStatus, disabled: refreshing, children: refreshing ? t("working") : (fa ? "به‌روزرسانی وضعیت اشتراک" : "Refresh subscription status") })] }), _jsxs("div", { className: "plan-comparison-wrap", children: [_jsxs("div", { className: "plan-comparison-heading", children: [_jsxs("div", { children: [_jsx("h3", { children: fa ? "مقایسه کامل محدودیت‌ها" : "Full limits comparison" }), _jsx("p", { children: fa ? "مقادیر زیر سقف‌های فعلی رابط و پردازش محلی هستند." : "These are the current interface and local-processing limits." })] }), _jsx("span", { children: fa ? "Free در برابر Pro" : "Free vs Pro" })] }), _jsx("div", { className: "plan-comparison-scroll", children: _jsxs("table", { className: "plan-comparison", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: fa ? "ابزار / ویژگی" : "Tool / feature" }), _jsx("th", { children: fa ? "رایگان" : "Free" }), _jsx("th", { children: "Pro" })] }) }), _jsx("tbody", { children: rows.map((row) => _jsxs("tr", { children: [_jsx("th", { scope: "row", children: row.group }), _jsx("td", { children: row.values[0] }), _jsx("td", { children: row.values[1] })] }, row.group)) })] }) })] }), _jsxs("div", { className: "plan-footnotes", children: [_jsxs("p", { children: [_jsx(Icon, { name: "shield-check", size: 16 }), fa ? "فایل‌ها در پردازش محلی روی دستگاه می‌مانند. انتخاب Pro به معنی آپلود خودکار اسناد نیست." : "Files remain on-device during local processing. Pro does not automatically upload documents."] }), _jsxs("p", { children: [_jsx(Icon, { name: "info", size: 16 }), fa ? "سهمیه AI فعلاً فقط برای زمان فعال‌سازی اتصال نمایش داده شده است؛ سرویس AI در نسخه فعلی خاموش است." : "AI quotas are shown for future activation; the AI service is disabled in this release."] }), _jsxs("p", { children: [_jsx(Icon, { name: "info", size: 16 }), fa ? "محدودیت ابزارهای محلی در مرورگر اعمال می‌شود و برای جلوگیری قطعی از دور زدن، باید خود ابزار به سرور منتقل شود؛ این کار با اصل Local-First انجام نمی‌شود." : "Local-tool limits are client-side usability limits. Tamper-proof enforcement would require server-side file processing, which this Local-First product intentionally avoids."] })] }), msg && _jsx("p", { role: "status", className: "error", children: msg })] }));
}

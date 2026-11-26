import { useState } from "react";
import { api, setToken, type Me } from "../core/permissions";
import { Icon } from "./icons";
import { getPlanLimits } from "../core/entitlements.js";

type T = (k: string) => string;
const errMsg = (t: T, e: unknown) => t("err." + (e as Error).message);

export type AuthMode = "login" | "register";

export function AuthForm({
  t,
  onDone,
  mode,
  onModeChange,
  onClose,
}: {
  t: T;
  onDone: () => void;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const validEmail = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const validPassword = Array.from(password).length >= 12 && Array.from(password).length <= 128;

  function changeMode(next: AuthMode) {
    onModeChange(next);
    setPassword("");
    setConfirmPassword("");
    setMsg("");
  }

  async function submit() {
    if (!validEmail || !validPassword || busy) return;
    if (mode === "register" && password !== confirmPassword) {
      setMsg(t("passwordMismatch"));
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      const path = mode === "register" ? "/api/auth/register" : "/api/auth/login";
      const result = await api<{ token: string }>(path, { email: email.trim().toLowerCase(), password });
      setToken(result.token);
      onDone();
    } catch (error) {
      setMsg(errMsg(t, error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-card" aria-labelledby="auth-title">
      <div className="auth-card-heading">
        <div>
          <h2 id="auth-title">{t(mode === "register" ? "authRegisterTitle" : "authLoginTitle")}</h2>
          <p>{t(mode === "register" ? "authRegisterHint" : "authLoginHint")}</p>
        </div>
        <button type="button" className="auth-close" onClick={onClose} aria-label={t("close")}>×</button>
      </div>

      <form className="auth-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className="field">
          <span>{t("email")}</span>
          <input type="email" name="email" autoComplete="email" maxLength={120}
            placeholder={t("email")} value={email} onChange={(event) => setEmail(event.target.value)}
            dir="ltr" required disabled={busy}/>
        </label>
        <label className="field">
          <span>{t("password")}</span>
          <input type={showPassword ? "text" : "password"} name="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            minLength={12} maxLength={128} value={password}
            onChange={(event) => setPassword(event.target.value)} dir="ltr" required disabled={busy}/>
        </label>
        {mode === "register" && <label className="field">
          <span>{t("confirmPassword")}</span>
          <input type={showPassword ? "text" : "password"} name="confirm-password"
            autoComplete="new-password" minLength={12} maxLength={128} value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)} dir="ltr" required disabled={busy}/>
        </label>}
        <button type="button" className="link auth-password-toggle" onClick={() => setShowPassword((value) => !value)} disabled={busy}>
          {t(showPassword ? "hidePassword" : "showPassword")}
        </button>
        {mode === "register" && <p className="auth-verification-note">{t("authUnverifiedSignupNote")}</p>}
        <button className="primary" type="submit" disabled={busy || !validEmail || !validPassword || (mode === "register" && password !== confirmPassword)}>
          {busy ? t("processing") : t(mode === "register" ? "createAccount" : "login")}
        </button>
      </form>

      {msg && <p className="auth-message" role="status" aria-live="polite">{msg}</p>}

      <div className="auth-mode-switch">
        {mode === "register" ? <>
          <span>{t("haveAccount")}</span>
          <button type="button" className="link" onClick={() => changeMode("login")}>{t("login")}</button>
        </> : <>
          <span>{t("noAccount")}</span>
          <button type="button" className="link" onClick={() => changeMode("register")}>{t("createAccount")}</button>
        </>}
      </div>
      <small className="muted">{t("consent")} <a href="#terms">{t("termsLink")}</a> · <a href="#privacy">{t("privacyLink")}</a></small>
    </section>
  );
}

export function LegacyPasswordSetup({ t, onDone }: { t: T; onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    if (Array.from(password).length < 12 || Array.from(password).length > 128) return;
    if (password !== confirmPassword) { setMessage(t("passwordMismatch")); return; }
    setBusy(true); setMessage("");
    try { await api("/api/auth/set-password", { password }); onDone(); }
    catch (error) { setMessage(errMsg(t, error)); }
    finally { setBusy(false); }
  }
  return <section className="auth-card legacy-password-setup">
    <h2>{t("legacyPasswordTitle")}</h2>
    <p>{t("legacyPasswordHint")}</p>
    <label className="field"><span>{t("password")}</span><input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} dir="ltr"/></label>
    <label className="field"><span>{t("confirmPassword")}</span><input type="password" autoComplete="new-password" minLength={12} maxLength={128} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} dir="ltr"/></label>
    <button className="primary" type="button" disabled={busy || Array.from(password).length < 12 || password !== confirmPassword} onClick={() => void save()}>{busy ? t("processing") : t("savePassword")}</button>
    {message && <p className="auth-message" role="status">{message}</p>}
  </section>;
}

export function Pricing({ t, lang, me, onLogin, onRefresh }: { t: T; lang: "fa" | "en"; me: Me | null; onLogin?: () => void; onRefresh?: () => Promise<boolean> }) {
  const fa = lang === "fa";
  const [msg, setMsg] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const freeTranslation = getPlanLimits("free").translation;
  const proTranslation = getPlanLimits("pro").translation;
  async function refreshStatus() {
    if (!onRefresh) return;
    setRefreshing(true); setMsg("");
    try { const ok = await onRefresh(); setMsg(ok ? (fa ? "وضعیت اشتراک از سرور به‌روزرسانی شد." : "Subscription status refreshed from the server.") : (fa ? "برای بررسی اشتراک ابتدا وارد حساب خود شوید یا اتصال سرور را بررسی کنید." : "Sign in or check the server connection to refresh your plan.")); }
    finally { setRefreshing(false); }
  }
  async function go(path: string, body: object) {
    try { location.href = (await api<{ url: string }>(path, body)).url; }
    catch (e) { setMsg(errMsg(t, e)); }
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
  return (
    <section className="plans-page" id="plans">
      <div className="plans-heading">
        <span className="plans-eyebrow">{fa ? "پلن‌ها و محدودیت‌ها" : "PLANS & LIMITS"}</span>
        <h2>{fa ? "کدام پلن برای شما مناسب‌تر است؟" : "Choose the plan that fits your workflow"}</h2>
        <p>{fa ? "همه ابزارهای پایه در پلن رایگان در دسترس‌اند؛ Pro ظرفیت بیشتری برای کارهای سنگین و دسته‌ای فراهم می‌کند." : "All core tools are available on Free. Pro raises the limits for larger and batch workflows."}</p>
      </div>
      <div className="plans">
        <div className={`plan ${me?.plan !== "pro" ? "plan-current" : ""}`}>
          <div className="plan-title-row"><h3 className="ph"><Icon name="device" size={20} />{t("planFree")}</h3>{me?.plan !== "pro" && <span className="plan-current-badge">{fa ? "پلن فعلی" : "Current plan"}</span>}</div>
          <div className="plan-price">{fa ? "رایگان" : "Free"}</div>
          <p>{fa ? "برای استفاده روزمره و شروع کار با همه فضاهای کاری." : "For everyday use and getting started with every workspace."}</p>
          <ul className="plan-highlights">
            <li>{fa ? "دسترسی به تمام ابزارهای پایه" : "Access to all core tools"}</li>
            <li>{fa ? "پردازش محلی و ذخیره روی دستگاه" : "Local processing and device storage"}</li>
            <li>{fa ? "سقف کمتر برای فایل، صفحه و پروژه" : "Lower file, page and project limits"}</li>
          </ul>
          {me?.plan !== "pro" && <span className="plan-selected-note">{fa ? "پلن رایگان شما فعال است" : "Your Free plan is active"}</span>}
        </div>
        <div className={`plan pro ${me?.plan === "pro" ? "plan-current" : ""}`}>
          <div className="plan-title-row"><h3 className="ph"><Icon name="crown" size={20} />{t("pro")}</h3><span className="plan-popular-badge">{fa ? "ظرفیت بالاتر" : "Higher limits"}</span></div>
          <div className="plan-price">Pro</div>
          <p>{fa ? "برای کاربران حرفه‌ای، اسناد بزرگ‌تر و پردازش دسته‌ای." : "For power users, larger documents and batch processing."}</p>
          <ul className="plan-highlights">
            <li>{fa ? "سقف بالاتر در تمام فضاهای کاری" : "Higher limits across all workspaces"}</li>
            <li>{fa ? "پروژه‌ها و پیش‌نویس‌های محلی بیشتر" : "More local projects and drafts"}</li>
            <li>{fa ? "سهمیه بیشتر AI پس از فعال‌سازی اتصال" : "Higher AI quotas after AI is enabled"}</li>
          </ul>
          {me?.plan === "pro" ? <><span className="plan-selected-note">{fa ? "اشتراک حرفه‌ای فعال است" : "Pro is active"}</span><p>{t("proUntil")} {me.planUntil ? new Date(me.planUntil * 1000).toLocaleDateString(lang) : (fa ? "—" : "—")}</p></> : me ? (
            <div className="stack plan-actions">
              <button className="primary" onClick={() => go("/api/billing/checkout", { provider: "stripe" })}><Icon name="card" size={16} />{t("payCard")}</button>
              {lang === "fa" && <button onClick={() => go("/api/billing/checkout", { provider: "zarinpal" })}>{t("payZarin")}</button>}
            </div>
          ) : <button className="primary" onClick={onLogin}>{fa ? "ورود برای خرید اشتراک" : "Sign in to subscribe"}</button>}
          {me?.hasStripe && <button onClick={() => go("/api/billing/portal", {})}><Icon name="card" size={16} />{t("manage")}</button>}
          <small className="muted">{fa ? "مبلغ نهایی توسط درگاه پرداخت نمایش داده می‌شود؛ زرین‌پال ۳۰ روزه و Stripe طبق دوره قیمت تنظیم‌شده است." : "The payment provider shows the configured price. Zarinpal grants 30 days; Stripe follows its configured billing period."}</small>
        </div>
      </div>
      <div className="plan-refresh-row"><span className="muted small">{fa ? "وضعیت اشتراک از سرور خوانده می‌شود." : "Subscription status is verified by the server."}</span><button type="button" onClick={refreshStatus} disabled={refreshing}>{refreshing ? t("working") : (fa ? "به‌روزرسانی وضعیت اشتراک" : "Refresh subscription status")}</button></div>
      <div className="plan-comparison-wrap">
        <div className="plan-comparison-heading"><div><h3>{fa ? "مقایسه کامل محدودیت‌ها" : "Full limits comparison"}</h3><p>{fa ? "مقادیر زیر سقف‌های فعلی رابط و پردازش محلی هستند." : "These are the current interface and local-processing limits."}</p></div><span>{fa ? "Free در برابر Pro" : "Free vs Pro"}</span></div>
        <div className="plan-comparison-scroll"><table className="plan-comparison"><thead><tr><th>{fa ? "ابزار / ویژگی" : "Tool / feature"}</th><th>{fa ? "رایگان" : "Free"}</th><th>Pro</th></tr></thead><tbody>{rows.map((row) => <tr key={row.group}><th scope="row">{row.group}</th><td>{row.values[0]}</td><td>{row.values[1]}</td></tr>)}</tbody></table></div>
      </div>
      <div className="plan-footnotes">
        <p><Icon name="shield-check" size={16}/>{fa ? "فایل‌ها در پردازش محلی روی دستگاه می‌مانند. انتخاب Pro به معنی آپلود خودکار اسناد نیست." : "Files remain on-device during local processing. Pro does not automatically upload documents."}</p>
        <p><Icon name="info" size={16}/>{fa ? "سهمیه AI فعلاً فقط برای زمان فعال‌سازی اتصال نمایش داده شده است؛ سرویس AI در نسخه فعلی خاموش است." : "AI quotas are shown for future activation; the AI service is disabled in this release."}</p>
        <p><Icon name="info" size={16}/>{fa ? "محدودیت ابزارهای محلی در مرورگر اعمال می‌شود و برای جلوگیری قطعی از دور زدن، باید خود ابزار به سرور منتقل شود؛ این کار با اصل Local-First انجام نمی‌شود." : "Local-tool limits are client-side usability limits. Tamper-proof enforcement would require server-side file processing, which this Local-First product intentionally avoids."}</p>
      </div>
      {msg && <p role="status" className="error">{msg}</p>}
    </section>
  );
}

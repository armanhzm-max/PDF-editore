import { useState, type FormEvent } from "react";
import type { Lang } from "../core/i18n";
import { Icon } from "./icons";
import { saveBlobToDeviceOrDownload } from "../core/device-folder";

type T = (key: string) => string;
type Category = "bug" | "feature" | "usability" | "other";

export default function Feedback({ t, lang }: { t: T; lang: Lang }) {
  const [category, setCategory] = useState<Category>("bug");
  const [rating, setRating] = useState("");
  const [message, setMessage] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminToken, setAdminToken] = useState("");
  const [exportBusy, setExportBusy] = useState(false);
  const [exportStatus, setExportStatus] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category, rating: rating ? Number(rating) : null, message, contact,
          locale: lang, pagePath: location.pathname + location.hash,
        }),
      });
      const data = await response.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error || "feedback_failed");
      setMessage("");
      setContact("");
      setStatus(t("feedbackSuccess"));
    } catch (error) {
      const code = (error as Error).message;
      setStatus(t(code === "too_many" ? "feedbackRateLimited" : "feedbackFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    if (!adminToken.trim()) return;
    setExportBusy(true);
    setExportStatus("");
    try {
      const response = await fetch("/api/feedback/export", {
        headers: { Authorization: `Bearer ${adminToken.trim()}` },
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error || "export_failed");
      }
      const blob = await response.blob();
      await saveBlobToDeviceOrDownload(blob, `pdf-ai-feedback-${new Date().toISOString().slice(0, 10)}.csv`);
      setExportStatus(t("feedbackExportSuccess"));
    } catch (error) {
      const code = (error as Error).message;
      setExportStatus(t(code === "feedback_export_not_configured" ? "feedbackAdminNotConfigured" : "feedbackExportFailed"));
    } finally {
      setExportBusy(false);
    }
  }

  return (
    <section className="feedback-page">
      <div className="feedback-intro">
        <span className="feedback-icon"><Icon name="message" size={28} /></span>
        <div>
          <h2>{t("feedbackTitle")}</h2>
          <p className="muted">{t("feedbackIntro")}</p>
        </div>
      </div>

      <form className="panel feedback-form" onSubmit={submit}>
        <label className="field">
          <span>{t("feedbackCategory")}</span>
          <select value={category} onChange={(event) => setCategory(event.target.value as Category)}>
            <option value="bug">{t("feedbackBug")}</option>
            <option value="feature">{t("feedbackFeature")}</option>
            <option value="usability">{t("feedbackUsability")}</option>
            <option value="other">{t("feedbackOther")}</option>
          </select>
        </label>

        <label className="field">
          <span>{t("feedbackRating")}</span>
          <select value={rating} onChange={(event) => setRating(event.target.value)}>
            <option value="">{t("feedbackNoRating")}</option>
            <option value="5">5 — {t("feedbackExcellent")}</option>
            <option value="4">4</option>
            <option value="3">3</option>
            <option value="2">2</option>
            <option value="1">1 — {t("feedbackPoor")}</option>
          </select>
        </label>

        <label className="field">
          <span>{t("feedbackMessage")}</span>
          <textarea minLength={10} maxLength={3000} rows={6} required value={message}
            placeholder={t("feedbackMessagePlaceholder")} onChange={(event) => setMessage(event.target.value)} />
          <small className="muted">{message.length}/3000</small>
        </label>

        <label className="field">
          <span>{t("feedbackContact")}</span>
          <input type="email" maxLength={120} value={contact} placeholder={t("feedbackContactPlaceholder")}
            onChange={(event) => setContact(event.target.value)} />
        </label>

        <p className="feedback-privacy"><Icon name="shield" size={16} />{t("feedbackPrivacy")}</p>
        <div className="feedback-actions">
          <button className="primary" type="submit" disabled={busy || message.trim().length < 10}>
            <Icon name="send" size={17} />{busy ? t("feedbackSending") : t("feedbackSubmit")}
          </button>
          {status && <span role="status" className="feedback-status">{status}</span>}
        </div>
      </form>

      <section className="panel feedback-admin">
        <button className="feedback-admin-toggle" type="button" aria-expanded={adminOpen} onClick={() => setAdminOpen((value) => !value)}>
          <span><Icon name="download" size={18} />{t("feedbackAdminTitle")}</span>
          <Icon name={adminOpen ? "chevron-up" : "chevron-down"} size={18} />
        </button>
        {adminOpen && <div className="feedback-admin-body">
          <p className="muted small">{t("feedbackAdminInfo")}</p>
          <label className="field">
            <span>{t("feedbackAdminToken")}</span>
            <input type="password" autoComplete="off" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} />
          </label>
          <div className="feedback-actions">
            <button type="button" onClick={exportCsv} disabled={exportBusy || adminToken.trim().length < 32}>
              <Icon name="download" size={17} />{exportBusy ? t("feedbackExporting") : t("feedbackDownload")}
            </button>
            {exportStatus && <span role="status" className="feedback-status">{exportStatus}</span>}
          </div>
        </div>}
      </section>
    </section>
  );
}

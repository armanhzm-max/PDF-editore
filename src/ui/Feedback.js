import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { Icon } from "./icons";
import { saveBlobToDeviceOrDownload } from "../core/device-folder";
export default function Feedback({ t, lang }) {
    const [category, setCategory] = useState("bug");
    const [rating, setRating] = useState("");
    const [message, setMessage] = useState("");
    const [contact, setContact] = useState("");
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    const [adminOpen, setAdminOpen] = useState(false);
    const [adminToken, setAdminToken] = useState("");
    const [exportBusy, setExportBusy] = useState(false);
    const [exportStatus, setExportStatus] = useState("");
    async function submit(event) {
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
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.ok)
                throw new Error(data.error || "feedback_failed");
            setMessage("");
            setContact("");
            setStatus(t("feedbackSuccess"));
        }
        catch (error) {
            const code = error.message;
            setStatus(t(code === "too_many" ? "feedbackRateLimited" : "feedbackFailed"));
        }
        finally {
            setBusy(false);
        }
    }
    async function exportCsv() {
        if (!adminToken.trim())
            return;
        setExportBusy(true);
        setExportStatus("");
        try {
            const response = await fetch("/api/feedback/export", {
                headers: { Authorization: `Bearer ${adminToken.trim()}` },
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.error || "export_failed");
            }
            const blob = await response.blob();
            await saveBlobToDeviceOrDownload(blob, `pdf-ai-feedback-${new Date().toISOString().slice(0, 10)}.csv`);
            setExportStatus(t("feedbackExportSuccess"));
        }
        catch (error) {
            const code = error.message;
            setExportStatus(t(code === "feedback_export_not_configured" ? "feedbackAdminNotConfigured" : "feedbackExportFailed"));
        }
        finally {
            setExportBusy(false);
        }
    }
    return (_jsxs("section", { className: "feedback-page", children: [_jsxs("div", { className: "feedback-intro", children: [_jsx("span", { className: "feedback-icon", children: _jsx(Icon, { name: "message", size: 28 }) }), _jsxs("div", { children: [_jsx("h2", { children: t("feedbackTitle") }), _jsx("p", { className: "muted", children: t("feedbackIntro") })] })] }), _jsxs("form", { className: "panel feedback-form", onSubmit: submit, children: [_jsxs("label", { className: "field", children: [_jsx("span", { children: t("feedbackCategory") }), _jsxs("select", { value: category, onChange: (event) => setCategory(event.target.value), children: [_jsx("option", { value: "bug", children: t("feedbackBug") }), _jsx("option", { value: "feature", children: t("feedbackFeature") }), _jsx("option", { value: "usability", children: t("feedbackUsability") }), _jsx("option", { value: "other", children: t("feedbackOther") })] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: t("feedbackRating") }), _jsxs("select", { value: rating, onChange: (event) => setRating(event.target.value), children: [_jsx("option", { value: "", children: t("feedbackNoRating") }), _jsxs("option", { value: "5", children: ["5 \u2014 ", t("feedbackExcellent")] }), _jsx("option", { value: "4", children: "4" }), _jsx("option", { value: "3", children: "3" }), _jsx("option", { value: "2", children: "2" }), _jsxs("option", { value: "1", children: ["1 \u2014 ", t("feedbackPoor")] })] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: t("feedbackMessage") }), _jsx("textarea", { minLength: 10, maxLength: 3000, rows: 6, required: true, value: message, placeholder: t("feedbackMessagePlaceholder"), onChange: (event) => setMessage(event.target.value) }), _jsxs("small", { className: "muted", children: [message.length, "/3000"] })] }), _jsxs("label", { className: "field", children: [_jsx("span", { children: t("feedbackContact") }), _jsx("input", { type: "email", maxLength: 120, value: contact, placeholder: t("feedbackContactPlaceholder"), onChange: (event) => setContact(event.target.value) })] }), _jsxs("p", { className: "feedback-privacy", children: [_jsx(Icon, { name: "shield", size: 16 }), t("feedbackPrivacy")] }), _jsxs("div", { className: "feedback-actions", children: [_jsxs("button", { className: "primary", type: "submit", disabled: busy || message.trim().length < 10, children: [_jsx(Icon, { name: "send", size: 17 }), busy ? t("feedbackSending") : t("feedbackSubmit")] }), status && _jsx("span", { role: "status", className: "feedback-status", children: status })] })] }), _jsxs("section", { className: "panel feedback-admin", children: [_jsxs("button", { className: "feedback-admin-toggle", type: "button", "aria-expanded": adminOpen, onClick: () => setAdminOpen((value) => !value), children: [_jsxs("span", { children: [_jsx(Icon, { name: "download", size: 18 }), t("feedbackAdminTitle")] }), _jsx(Icon, { name: adminOpen ? "chevron-up" : "chevron-down", size: 18 })] }), adminOpen && _jsxs("div", { className: "feedback-admin-body", children: [_jsx("p", { className: "muted small", children: t("feedbackAdminInfo") }), _jsxs("label", { className: "field", children: [_jsx("span", { children: t("feedbackAdminToken") }), _jsx("input", { type: "password", autoComplete: "off", value: adminToken, onChange: (event) => setAdminToken(event.target.value) })] }), _jsxs("div", { className: "feedback-actions", children: [_jsxs("button", { type: "button", onClick: exportCsv, disabled: exportBusy || adminToken.trim().length < 32, children: [_jsx(Icon, { name: "download", size: 17 }), exportBusy ? t("feedbackExporting") : t("feedbackDownload")] }), exportStatus && _jsx("span", { role: "status", className: "feedback-status", children: exportStatus })] })] })] })] }));
}

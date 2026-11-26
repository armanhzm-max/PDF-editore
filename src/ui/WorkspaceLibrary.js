import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useRef, useState } from "react";
import { clearWorkspaceItems, deleteWorkspaceItem, exportWorkspaceBackup, importWorkspaceBackup, importWorkspaceDraftsFromConnectedFolder, listWorkspaceItems, getWorkspaceLimits, syncWorkspaceDraftsToConnectedFolder } from "../core/local-workspace";
import { Icon } from "./icons";
import { connectDeviceFolder, disconnectDeviceFolder, getDeviceFolderStatus, requestDeviceFolderPermission, saveBlobToDeviceOrDownload } from "../core/device-folder";
const labels = {
    word: { fa: "سند Word", en: "Word document", icon: "word" },
    excel: { fa: "صفحه‌گسترده Excel", en: "Excel workbook", icon: "excel" },
    ppt: { fa: "ارائه PowerPoint", en: "PowerPoint presentation", icon: "ppt" },
    documents: { fa: "فضای اسناد AI", en: "AI Documents workspace", icon: "brain" },
};
function dateLabel(value, lang) {
    try {
        return new Intl.DateTimeFormat(lang === "fa" ? "fa-IR" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
    }
    catch {
        return new Date(value).toLocaleString();
    }
}
function sizeLabel(bytes) { return bytes >= 1024 * 1024 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`; }
async function downloadBlob(blob, name) {
    return saveBlobToDeviceOrDownload(blob, name);
}
export default function WorkspaceLibrary({ lang, plan, onOpen }) {
    const fa = lang === "fa";
    const limits = getWorkspaceLimits(plan);
    const input = useRef(null);
    const [items, setItems] = useState([]);
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const [filter, setFilter] = useState("all");
    const [search, setSearch] = useState("");
    const [folder, setFolder] = useState({ supported: false, connected: false, name: null, permission: "unknown" });
    async function refresh() { setItems(await listWorkspaceItems()); }
    async function refreshFolder() { setFolder(await getDeviceFolderStatus()); }
    useEffect(() => {
        void refresh().catch(() => setError(fa ? "خواندن فضای ذخیره محلی ناموفق بود." : "Could not read local workspace storage."));
        void refreshFolder().catch(() => setFolder({ supported: false, connected: false, name: null, permission: "unknown" }));
    }, []);
    const filtered = filter === "all" ? items : items.filter((item) => item.kind === filter);
    const visible = search.trim() ? filtered.filter((item) => `${item.name} ${item.preview}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) : filtered;
    const usedBytes = items.reduce((sum, item) => sum + item.bytes, 0);
    const usagePercent = Math.min(100, usedBytes / limits.maxTotalBytes * 100);
    async function remove(item) {
        const confirmText = fa ? `«${item.name}» از فضای محلی حذف شود؟` : `Delete “${item.name}” from this device?`;
        if (!window.confirm(confirmText))
            return;
        try {
            await deleteWorkspaceItem(item.id);
            await refresh();
            setStatus(fa ? "پیش‌نویس محلی حذف شد." : "Local draft deleted.");
        }
        catch {
            setError(fa ? "حذف پیش‌نویس ناموفق بود." : "Could not delete the local draft.");
        }
    }
    async function clearAll() {
        if (!items.length)
            return;
        if (!window.confirm(fa ? `همه ${items.length} پیش‌نویس از حافظه این مرورگر حذف شوند؟ فایل‌های پشتیبان داخل پوشه انتخابی حذف نمی‌شوند. این کار قابل بازگشت نیست؛ ابتدا پشتیبان بگیرید.` : `Delete all ${items.length} drafts from this browser storage? Snapshot files in the selected folder will remain. This cannot be undone; export a backup first.`))
            return;
        setBusy(true);
        setError("");
        try {
            const count = await clearWorkspaceItems();
            await refresh();
            setStatus(fa ? `${count} پیش‌نویس حذف شد.` : `${count} local draft(s) deleted.`);
        }
        catch {
            setError(fa ? "پاک‌سازی فضای محلی ناموفق بود." : "Could not clear local workspace storage.");
        }
        finally {
            setBusy(false);
        }
    }
    async function backup() {
        setBusy(true);
        setError("");
        try {
            await downloadBlob(await exportWorkspaceBackup(), `pdf-ai-tools-workspace-${new Date().toISOString().slice(0, 10)}.json`);
            setStatus(fa ? "پشتیبان در پوشه انتخابی یا مسیر ذخیره معمول دستگاه قرار گرفت." : "Backup saved to the selected folder or the device's normal download location.");
        }
        catch (caught) {
            const tooLarge = caught instanceof Error && caught.message === "workspace_backup_too_large";
            setError(fa ? (tooLarge ? `حجم پشتیبان از ۲۵ مگابایت بیشتر است؛ چند پیش‌نویس قدیمی را حذف کنید و دوباره بگیرید.` : "ساخت پشتیبان ناموفق بود؛ فضای ذخیره‌سازی را بررسی کنید.") : (tooLarge ? `The backup exceeds 25 MB. Delete older drafts and try again.` : "Could not create the backup. Check available storage."));
        }
        finally {
            setBusy(false);
        }
    }
    async function restore(file) {
        if (!file)
            return;
        if (!window.confirm(fa ? "محتوای پشتیبان به فضای محلی این مرورگر افزوده می‌شود و ممکن است پیش‌نویس‌های هم‌شناسه جایگزین شوند. ادامه می‌دهید؟" : "Backup items will be merged into this browser. Items with matching IDs may be replaced. Continue?")) {
            if (input.current)
                input.current.value = "";
            return;
        }
        setBusy(true);
        setError("");
        try {
            const count = await importWorkspaceBackup(file);
            await refresh();
            setStatus(fa ? `${count} مورد از پشتیبان بازیابی شد.` : `${count} item(s) restored from backup.`);
        }
        catch (caught) {
            const code = caught instanceof Error ? caught.message : "";
            setError(fa ? (code === "workspace_plan_limit" ? "ظرفیت پلن رایگان برای بازیابی همه پیش‌نویس‌ها کافی نیست؛ پلن Pro ظرفیت بیشتری دارد. فایل‌های موجود حذف نشده‌اند." : "فایل پشتیبان معتبر نیست یا بیش از حد بزرگ است.") : (code === "workspace_plan_limit" ? "The current plan does not have enough local workspace capacity for all drafts. Pro offers more capacity; existing files were not deleted." : "The backup file is invalid or too large."));
        }
        finally {
            setBusy(false);
            if (input.current)
                input.current.value = "";
        }
    }
    async function connectFolder() {
        setBusy(true);
        setError("");
        try {
            const selected = await connectDeviceFolder();
            setFolder(selected);
            const imported = await importWorkspaceDraftsFromConnectedFolder();
            await refresh();
            const synced = await syncWorkspaceDraftsToConnectedFolder();
            setStatus(fa ? `پوشه «${selected.name ?? ""}» متصل شد؛ ${imported} مورد از پوشه بازیابی و ${synced.saved} پیش‌نویس همگام شد.` : `Connected “${selected.name ?? ""}”; restored ${imported} draft(s) from the folder and synced ${synced.saved}.`);
        }
        catch (caught) {
            const code = caught instanceof Error ? caught.message : "";
            if (code === "AbortError")
                return;
            setError(fa ? (code === "folder_access_unsupported" ? "این مرورگر اتصال مستقیم پوشه را پشتیبانی نمی‌کند؛ از ذخیره معمول دستگاه استفاده می‌شود." : "اتصال پوشه انجام نشد یا اجازه نوشتن داده نشد.") : (code === "folder_access_unsupported" ? "This browser does not support direct folder access; normal device saving will be used." : "Could not connect the folder or write permission was not granted."));
        }
        finally {
            setBusy(false);
            await refreshFolder();
        }
    }
    async function grantFolderAccess() {
        setBusy(true);
        setError("");
        try {
            const selected = await requestDeviceFolderPermission();
            setFolder(selected);
            const synced = await syncWorkspaceDraftsToConnectedFolder();
            setStatus(fa ? `دسترسی پوشه برقرار شد؛ ${synced.saved} پیش‌نویس همگام شد.` : `Folder access restored; synced ${synced.saved} draft(s).`);
        }
        catch {
            setError(fa ? "اجازه دسترسی پوشه داده نشد. دوباره تلاش کنید یا پوشه را مجدداً متصل کنید." : "Folder permission was not granted. Try again or reconnect the folder.");
        }
        finally {
            setBusy(false);
            await refreshFolder();
        }
    }
    async function syncFolder() {
        setBusy(true);
        setError("");
        try {
            const result = await syncWorkspaceDraftsToConnectedFolder();
            setStatus(fa ? `${result.saved} پیش‌نویس ذخیره شد؛ ${result.skipped} مورد به مجوز یا دسترسی نیاز دارد.` : `${result.saved} draft(s) saved; ${result.skipped} skipped due to permission or access.`);
        }
        catch {
            setError(fa ? "همگام‌سازی پوشه ناموفق بود." : "Could not sync drafts to the folder.");
        }
        finally {
            setBusy(false);
            await refreshFolder();
        }
    }
    async function importFromFolder() {
        if (!window.confirm(fa ? "پیش‌نویس‌های PDF AI Tools از پوشه انتخاب‌شده به فضای کاری این مرورگر اضافه شوند؟" : "Import PDF AI Tools drafts from the connected folder into this browser workspace?"))
            return;
        setBusy(true);
        setError("");
        try {
            const count = await importWorkspaceDraftsFromConnectedFolder();
            await refresh();
            setStatus(fa ? `${count} پیش‌نویس از پوشه بازیابی شد.` : `Imported ${count} draft(s) from the folder.`);
        }
        catch {
            setError(fa ? "خواندن پوشه ممکن نشد؛ دسترسی پوشه را دوباره تأیید کنید." : "Could not read the folder. Re-authorize folder access and retry.");
        }
        finally {
            setBusy(false);
            await refreshFolder();
        }
    }
    async function disconnectFolder() {
        if (!window.confirm(fa ? "اتصال پوشه قطع شود؟ فایل‌هایی که قبلاً در پوشه ذخیره شده‌اند حذف نمی‌شوند." : "Disconnect this folder? Files already saved there will not be deleted."))
            return;
        setBusy(true);
        try {
            await disconnectDeviceFolder();
            await refreshFolder();
            setStatus(fa ? "اتصال پوشه قطع شد؛ فایل‌های داخل پوشه دست‌نخورده باقی ماندند." : "Folder disconnected; existing files were left untouched.");
        }
        catch {
            setError(fa ? "قطع اتصال پوشه ناموفق بود." : "Could not disconnect the folder.");
        }
        finally {
            setBusy(false);
        }
    }
    return _jsxs("main", { className: "local-library-page", children: [_jsxs("section", { className: "library-intro", children: [_jsx("div", { className: "library-intro-icon", children: _jsx(Icon, { name: "library", size: 28 }) }), _jsxs("div", { children: [_jsx("span", { className: "hub-eyebrow", children: fa ? "فضای کاری روی همین دستگاه" : "ON THIS DEVICE" }), _jsx("h2", { children: fa ? "پروژه‌ها و فایل‌های اخیر" : "Projects & recent work" }), _jsx("p", { children: fa ? "پیش‌نویس‌های Word، Excel، PowerPoint و متن‌های آماده تحلیل روی همین دستگاه ذخیره می‌شوند. با اتصال پوشه، نسخه‌های پشتیبان برنامه نیز در پوشه انتخابی نگهداری و قابل بازیابی خواهند بود." : "Word, Excel, PowerPoint drafts and extracted document text stay on this device. Connect a folder to keep app-owned backups there for recovery." }), _jsxs("p", { className: "library-privacy", children: [_jsx(Icon, { name: "shield", size: 15 }), fa ? "محتوای سند برای ذخیره‌سازی به سرور یا D1 ارسال نمی‌شود. نسخه مرورگر و فایل‌های پوشه رمزگذاری جداگانه ندارند؛ برای اسناد حساس احتیاط کنید. پاک‌کردن داده مرورگر می‌تواند نسخه مرورگر را حذف کند؛ پوشه انتخابی جداگانه باقی می‌ماند." : "Document content is not uploaded to the server or D1 for storage. Browser drafts and folder files are not separately encrypted; use care with sensitive documents. Clearing browser data may remove the browser copy; the selected folder remains separate."] })] })] }), _jsxs("section", { className: "device-folder-card panel", children: [_jsxs("div", { className: "device-folder-main", children: [_jsx("span", { className: "device-folder-icon", children: _jsx(Icon, { name: "folder-open", size: 25 }) }), _jsxs("div", { className: "device-folder-copy", children: [_jsx("strong", { children: fa ? "پوشه ذخیره‌سازی روی دستگاه" : "Save to a folder on this device" }), _jsx("p", { children: fa ? "پس از انتخاب پوشه و تأیید پنجره مرورگر، خروجی‌ها و نسخه‌های کاری مستقیماً همان‌جا ذخیره می‌شوند. سایت فقط به پوشه انتخابی دسترسی می‌گیرد؛ فایل‌ها و شناسه پوشه به پایگاه داده اسناد سرور ارسال نمی‌شوند." : "After you select a folder and approve the browser prompt, exports and drafts are saved there. The site receives access only to that folder; files and the folder handle are not sent to a server document database." }), folder.connected && _jsxs("span", { className: `device-folder-state ${folder.permission === "granted" ? "ok" : "needs-permission"}`, children: [_jsx(Icon, { name: folder.permission === "granted" ? "check" : "alert-triangle", size: 14 }), folder.name || (fa ? "پوشه متصل" : "Connected folder"), " \u00B7 ", folder.permission === "granted" ? (fa ? "اجازه نوشتن فعال" : "Write access active") : (fa ? "نیازمند تأیید دوباره" : "Permission needs renewal")] })] })] }), _jsx("div", { className: "device-folder-actions", children: !folder.connected ? _jsxs("button", { className: "primary", onClick: () => void connectFolder(), disabled: busy || !folder.supported, children: [_jsx(Icon, { name: "folder-open", size: 16 }), fa ? "انتخاب پوشه و اتصال" : "Choose and connect folder"] }) : _jsxs(_Fragment, { children: [folder.permission !== "granted" && _jsxs("button", { className: "primary", onClick: () => void grantFolderAccess(), disabled: busy, children: [_jsx(Icon, { name: "shield", size: 16 }), fa ? "اجازه دسترسی" : "Grant access"] }), _jsxs("button", { onClick: () => void syncFolder(), disabled: busy || folder.permission !== "granted", children: [_jsx(Icon, { name: "rotate-cw", size: 16 }), fa ? "همگام‌سازی پیش‌نویس‌ها" : "Sync drafts"] }), _jsxs("button", { onClick: () => void importFromFolder(), disabled: busy || folder.permission !== "granted", children: [_jsx(Icon, { name: "download", size: 16 }), fa ? "بازیابی از پوشه" : "Import from folder"] }), _jsxs("button", { className: "library-clear", onClick: () => void disconnectFolder(), disabled: busy, children: [_jsx(Icon, { name: "files", size: 16 }), fa ? "قطع اتصال" : "Disconnect"] })] }) }), !folder.supported && _jsx("p", { className: "device-folder-note", children: fa ? "اتصال دائمی پوشه در این مرورگر/دستگاه در دسترس نیست. فایل‌ها با روش استاندارد ذخیره یا دانلود می‌شوند؛ برای انتخاب پوشه در هر بار ذخیره از پنجره خود دستگاه استفاده کنید." : "Persistent folder linking is not available in this browser/device. Files will use the device's normal save or download flow." }), _jsx("p", { className: "device-folder-note", children: fa ? "پیشنهاد: یک پوشه اختصاصی مثل «PDF AI Tools» بسازید و فقط همان را انتخاب کنید، نه کل Documents یا Desktop. مجوز فقط پس از انتخاب شما درخواست می‌شود؛ مرورگر ممکن است بعداً تأیید دوباره بخواهد. قطع اتصال، فایل‌های پوشه را حذف نمی‌کند." : "Tip: create a dedicated folder such as “PDF AI Tools” and select only that folder, not your entire Documents or Desktop. Permission is requested only after your choice; the browser may ask again later. Disconnecting never deletes its files." }), _jsx("p", { className: "device-folder-note", children: fa ? "فضای کاری و اتصال پوشه به پروفایل همین مرورگر وابسته است، نه به حساب ورود سایت. روی دستگاه مشترک، برای هر نفر از پروفایل جداگانه مرورگر یا حساب کاربری جداگانه سیستم استفاده کنید." : "Workspace drafts and the folder link belong to this browser profile, not to a website login. On shared devices, use a separate browser profile or operating-system account for each person." })] }), _jsxs("section", { className: "library-plan-note panel", children: [_jsxs("div", { children: [_jsx("strong", { children: fa ? `پلن ${plan === "pro" ? "Pro" : "Free"} · ظرفیت فضای کاری` : `${plan === "pro" ? "Pro" : "Free"} plan · Workspace capacity` }), _jsx("p", { children: fa ? `تا ${limits.maxRecords} پیش‌نویس، ${limits.maxRecordBytes / 1048576} مگابایت برای هر مورد و ${limits.maxTotalBytes / 1048576} مگابایت در مجموع. ارتقا به Pro فایل‌های فعلی را حذف نمی‌کند و ظرفیت بیشتر را برای ذخیره‌های بعدی باز می‌کند.` : `Up to ${limits.maxRecords} drafts, ${limits.maxRecordBytes / 1048576} MB per draft and ${limits.maxTotalBytes / 1048576} MB total. Upgrading to Pro never deletes existing files and raises capacity for future saves.` })] }), plan !== "pro" && _jsx("button", { type: "button", onClick: () => { location.hash = "plans"; }, children: fa ? "مشاهده پلن Pro" : "View Pro plan" })] }), _jsxs("section", { className: "library-plan-note panel", children: [_jsxs("div", { children: [_jsx("strong", { children: fa ? `ظرفیت پلن ${plan === "pro" ? "Pro" : "Free"}` : `${plan === "pro" ? "Pro" : "Free"} workspace capacity` }), _jsx("p", { children: fa ? `حداکثر ${limits.maxRecords} پیش‌نویس، ${sizeLabel(limits.maxRecordBytes)} برای هر مورد و ${sizeLabel(limits.maxTotalBytes)} در مجموع. اگر اشتراک تمام شود، فایل‌های قبلی حذف نمی‌شوند؛ فقط ذخیره‌های جدید تا آزاد شدن ظرفیت محدود می‌شوند.` : `Up to ${limits.maxRecords} drafts, ${sizeLabel(limits.maxRecordBytes)} per item and ${sizeLabel(limits.maxTotalBytes)} total. If Pro expires, existing files are kept; new saves are limited until capacity is freed.` })] }), plan !== "pro" && _jsx("button", { type: "button", onClick: () => { location.hash = "plans"; }, children: fa ? "مقایسه و ارتقا به Pro" : "Compare and upgrade to Pro" })] }), _jsxs("section", { className: "library-toolbar panel", children: [_jsx("div", { className: "library-filters", children: ["all", "word", "excel", "ppt", "documents"].map((kind) => _jsx("button", { className: filter === kind ? "active" : "", onClick: () => setFilter(kind), children: kind === "all" ? (fa ? "همه" : "All") : labels[kind].fa === "فضای اسناد AI" ? "AI" : labels[kind][lang] }, kind)) }), _jsxs("label", { className: "library-search", children: [_jsx(Icon, { name: "search", size: 16 }), _jsx("input", { value: search, onChange: (event) => setSearch(event.target.value), placeholder: fa ? "جست‌وجوی نام یا محتوای پیش‌نویس..." : "Search draft names and previews..." })] }), _jsxs("div", { className: "library-backups", children: [_jsx("input", { ref: input, hidden: true, type: "file", accept: "application/json,.json", onChange: (event) => void restore(event.target.files?.[0]) }), _jsxs("button", { onClick: () => void backup(), disabled: busy, children: [_jsx(Icon, { name: "download", size: 16 }), fa ? "دریافت پشتیبان" : "Export backup"] }), _jsxs("button", { onClick: () => input.current?.click(), disabled: busy, children: [_jsx(Icon, { name: "upload", size: 16 }), fa ? "بازیابی پشتیبان" : "Restore backup"] }), _jsxs("button", { className: "library-clear", onClick: () => void clearAll(), disabled: busy || !items.length, children: [_jsx(Icon, { name: "trash", size: 16 }), fa ? "پاک‌سازی همه" : "Clear all"] })] }), _jsxs("div", { className: "library-usage", children: [_jsxs("div", { children: [_jsx("span", { children: fa ? `فضای کاری · ${items.length}/${limits.maxRecords} پیش‌نویس` : `Workspace · ${items.length}/${limits.maxRecords} drafts` }), _jsxs("strong", { children: [(usedBytes / 1048576).toFixed(1), " / ", (limits.maxTotalBytes / 1048576).toFixed(0), " MB"] })] }), _jsx("div", { className: "library-usage-track", children: _jsx("span", { style: { width: `${usagePercent}%` } }) })] })] }), status && _jsx("p", { className: "library-status", role: "status", children: status }), error && _jsx("p", { className: "error", role: "alert", children: error }), visible.length ? _jsx("section", { className: "library-grid", children: visible.map((item) => _jsxs("article", { className: "library-card", children: [_jsxs("div", { className: "library-card-top", children: [_jsx("span", { className: `library-kind ${item.kind}`, children: _jsx(Icon, { name: labels[item.kind].icon, size: 21 }) }), _jsx("span", { className: "library-kind-label", children: labels[item.kind][lang] })] }), _jsx("h3", { dir: "auto", children: item.name }), _jsx("p", { className: "library-preview", dir: "auto", children: item.preview || (fa ? "پیش‌نویس محلی" : "Local draft") }), _jsxs("div", { className: "library-meta", children: [_jsx("span", { children: dateLabel(item.updatedAt, lang) }), _jsx("span", { children: sizeLabel(item.bytes) })] }), _jsxs("div", { className: "library-card-actions", children: [_jsxs("button", { className: "primary", onClick: () => onOpen(item), children: [_jsx(Icon, { name: "folder-open", size: 15 }), fa ? "باز کردن" : "Open"] }), _jsx("button", { className: "library-delete", onClick: () => void remove(item), "aria-label": fa ? "حذف پیش‌نویس" : "Delete draft", children: _jsx(Icon, { name: "trash", size: 16 }) })] })] }, item.id)) }) : _jsxs("section", { className: "library-empty", children: [_jsx(Icon, { name: "library", size: 42 }), _jsx("strong", { children: search.trim() ? (fa ? "موردی پیدا نشد" : "No matching drafts") : (fa ? "هنوز پیش‌نویسی ذخیره نشده است" : "No saved drafts yet") }), _jsx("p", { children: search.trim() ? (fa ? "عبارت دیگری را جست‌وجو کنید یا فیلتر را تغییر دهید." : "Try another search or change the filter.") : (fa ? "یک سند Word، صفحه‌گسترده Excel یا ارائه را ویرایش کنید؛ پس از تغییرات، ذخیره خودکار انجام می‌شود." : "Edit a Word document, spreadsheet or presentation. Changes will be saved here automatically.") })] }), _jsx("p", { className: "library-footnote", children: fa ? `حافظه مرورگر محدود است؛ فایل‌های ذخیره‌شده در پوشه انتخابی جدا از این شمارنده هستند.` : "Browser cache is bounded; files in your selected folder are separate from this meter." })] });
}

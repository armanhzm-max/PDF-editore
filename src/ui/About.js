import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// متن‌ها را با اطلاعات واقعی کسب‌وکار خودتان جایگزین کنید (نام، ایمیل، قیمت‌ها)
const C = {
    fa: {
        h: "درباره ما",
        intro: "ما ابزارهایی ساخته‌ایم که کارهای روزمره با PDF، تصویر و اسناد Office را داخل مرورگر انجام می‌دهند. با اجازه شما می‌توان خروجی‌ها و نسخه‌های کاری را مستقیماً در پوشه‌ای روی دستگاه خودتان ذخیره کرد. اتصال هوش مصنوعی در این نسخه هنوز غیرفعال است و محتوای سند برای تحلیل AI ارسال نمی‌شود.",
        howH: "چطور کار می‌کند",
        steps: [
            ["فایل را انتخاب کنید", "فایل از دستگاه شما خوانده می‌شود و ابزارهای محلی آن را برای پردازش به سرور اسناد آپلود نمی‌کنند."],
            ["محل ذخیره را تعیین کنید", "در «فضای کاری من» پوشه دلخواه را انتخاب و اجازه خواندن/نوشتن را فقط از طریق پنجره مرورگر تأیید کنید."],
            ["نتیجه را ذخیره کنید", "وقتی پوشه متصل و مجوز فعال باشد، خروجی‌ها و پیش‌نویس‌ها در همان پوشه ذخیره می‌شوند؛ در غیر این صورت روش معمول ذخیره/دانلود دستگاه استفاده می‌شود."],
        ],
        privH: "قول‌های ما درباره حریم خصوصی",
        priv: [
            "فایل‌های PDF، Word، Excel، PowerPoint و تصاویر برای ابزارهای محلی و ذخیره سند در پوشه شخصی به سرور اسناد آپلود نمی‌شوند.",
            "اتصال پوشه فقط پس از انتخاب صریح شما انجام می‌شود. مرورگر ممکن است دوباره اجازه بخواهد؛ می‌توانید اتصال را قطع کنید. نام پوشه و شناسه دسترسی آن به سرور ارسال نمی‌شود.",
            "پیش‌نویس‌ها در حافظه محلی مرورگر نگهداری می‌شوند و در صورت اتصال پوشه، نسخه پشتیبان برنامه با نام مشخص در همان پوشه نوشته می‌شود. نسخه مرورگر و پوشه رمزگذاری جداگانه ندارند. فضای کاری به پروفایل مرورگر وابسته است، نه حساب ورود سایت؛ روی دستگاه مشترک برای هر نفر پروفایل جداگانه بسازید.",
            "قابلیت‌های AI در این نسخه آماده‌سازی شده‌اند اما اتصال مدل غیرفعال است؛ هیچ متن سند یا پرسشی برای پردازش AI به ارائه‌دهنده مدل ارسال نمی‌شود.",
            "برای اداره حساب، ایمیل، وضعیت اشتراک، سوابق ضروری پرداخت و بازخوردهایی که خودتان ارسال می‌کنید، داده‌های محدودی در سرور نگهداری می‌شود؛ محتوای اسناد در D1 ذخیره نمی‌شود.",
        ],
        planH: "رایگان و حرفه‌ای",
        plan: "ابزارهای پایه رایگان‌اند و هر بار روی یک فایل کار می‌کنند. اشتراک حرفه‌ای قابلیت‌های افزوده را باز می‌کند؛ امکانات متصل به هوش مصنوعی تا زمان فعال‌سازی جداگانه غیرفعال می‌مانند.",
        faqH: "پرسش‌های متداول",
        faq: [
            ["اتصال پوشه در چه مرورگرهایی کار می‌کند؟", "اتصال مستقیم پوشه به پشتیبانی مرورگر و اجرای سایت روی HTTPS یا localhost وابسته است؛ Chrome و Edge دسکتاپ پیشنهاد می‌شوند. در مرورگرهایی که انتخاب دائمی پوشه را پشتیبانی نمی‌کنند، ذخیره یا دانلود معمول دستگاه استفاده می‌شود. روی موبایل ممکن است این قابلیت محدود باشد."],
            ["چرا بعد از فشرده‌سازی PDF متن قابل انتخاب نیست؟", "برای کم کردن حجم، صفحات به تصویر تبدیل می‌شوند. اگر نیاز به متن دارید، از OCR استفاده کنید."],
            ["دقت OCR فارسی چقدر است؟", "روی متن‌های تایپی و اسکن‌های واضح بهتر است. روی دست‌خط یا اسکن‌های کم‌کیفیت ممکن است اشتباه داشته باشد. در Scan Center می‌توانید تصویر یا PDF اسکن‌شده را وارد کنید و با انتخاب محدوده خواندن، بخش‌های اضافی هر صفحه را از OCR خارج کنید."],
            ["اشتراکم را چطور لغو کنم؟", "اگر با کارت پرداخت کرده‌اید، از دکمه «مدیریت یا لغو اشتراک» در کارت حرفه‌ای پایین صفحه لغو کنید. اشتراک زرین‌پال تمدید خودکار ندارد و خودش پایان می‌یابد."],
        ],
        contactH: "تماس با ما",
        contact: "پیشنهاد، اشکال یا سؤال دارید؟ برایمان بنویسید:",
    },
    en: {
        h: "About us",
        intro: "We build tools that process PDF, image and Office documents in your browser. With your permission, exports and workspace drafts can be saved directly in a folder on your device. AI model access is currently disabled, so document content is not sent for AI analysis.",
        howH: "How it works",
        steps: [
            ["Pick a file", "You choose a file from your device; local tools do not upload it to a server document store."],
            ["Choose where to save", "In My Workspace, select a folder and approve browser read/write access in the native picker."],
            ["Save the result", "When the folder is connected and permission is active, exports and drafts are written there. Otherwise the device's normal save/download flow is used."],
        ],
        privH: "Our privacy promises",
        priv: [
            "PDF, Word, Excel, PowerPoint and image files used by local tools are not uploaded to a server document store.",
            "Folder access is connected only after you choose a directory. The browser may ask for permission again, and you can disconnect it. The folder name and permission handle are not sent to our server.",
            "Workspace drafts remain in browser storage and, when a folder is connected, an app-owned backup snapshot is written there. Browser and folder copies are not separately encrypted. The workspace is tied to the browser profile, not a website login; use a separate browser profile for each person on shared devices.",
            "AI features are prepared but model access is disabled in this release. No document text or prompts are sent to an AI provider for processing.",
            "We keep limited account, subscription, payment and feedback data that you submit; document content is not stored in D1.",
        ],
        planH: "Free and Pro",
        plan: "Basic tools are free and work on one file at a time. Pro unlocks additional features; AI-connected features remain disabled until separately activated.",
        faqH: "Frequently asked questions",
        faq: [
            ["Which browsers support folder linking?", "Direct folder access depends on browser support and requires HTTPS or localhost. Chrome and Edge on desktop are recommended. Other browsers use the device's normal save/download flow; persistent folder linking may be limited on mobile."],
            ["Why can't I select text after compressing a PDF?", "To shrink the file, pages are turned into images. Use OCR if you need the text."],
            ["How accurate is Persian OCR?", "It works better on typed text and clean scans. Handwriting or low-quality scans may contain mistakes. In Scan Center, import an image or scanned PDF and use the reading-area selector to exclude irrelevant parts of each page."],
            ["How do I cancel my subscription?", "If you paid by card, use “Manage or cancel subscription” in the Pro card at the bottom of the page. Zarinpal passes don’t renew and simply end."],
        ],
        contactH: "Contact",
        contact: "Suggestions, bugs or questions? Write to us:",
    },
};
const EMAIL = "support@your-domain.com";
export default function About({ lang }) {
    const c = C[lang];
    return (_jsxs("article", { className: "about", children: [_jsx("h2", { className: "about-title", children: c.h }), _jsx("p", { className: "lead", children: c.intro }), _jsx("h3", { children: c.howH }), _jsx("ol", { className: "steps", children: c.steps.map(([a, b]) => _jsxs("li", { children: [_jsx("strong", { children: a }), _jsx("span", { children: b })] }, a)) }), _jsx("h3", { children: c.privH }), _jsx("ul", { className: "promises", children: c.priv.map((p) => _jsx("li", { children: p }, p)) }), _jsx("h3", { children: c.planH }), _jsx("p", { children: c.plan }), _jsx("h3", { children: c.faqH }), _jsx("div", { className: "faq", children: c.faq.map(([q, a]) => _jsxs("details", { children: [_jsx("summary", { children: q }), _jsx("p", { children: a })] }, q)) }), _jsxs("div", { className: "contact", children: [_jsx("h3", { children: c.contactH }), _jsxs("p", { children: [c.contact, " ", _jsx("a", { href: `mailto:${EMAIL}`, dir: "ltr", children: EMAIL })] })] })] }));
}

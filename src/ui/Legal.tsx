import type { Lang } from "../core/i18n";

// قالب‌ها را با اطلاعات واقعی کسب‌وکارتان کامل کنید و پیش از انتشار یک حقوق‌دان آن را بررسی کند.
const EMAIL = "support@your-domain.com";
type Doc = { title: string; updated: string; sections: [string, string[]][] };

const D: Record<Lang, { privacy: Doc; terms: Doc }> = {
  fa: {
    privacy: {
      title: "سیاست حریم خصوصی",
      updated: "آخرین به‌روزرسانی: 2026-11-22",
      sections: [
        ["خلاصه", ["ابزارهای محلی فایل‌ها را داخل مرورگر پردازش می‌کنند. با اجازه صریح شما، خروجی‌ها و پیش‌نویس‌ها می‌توانند در پوشه‌ای که روی دستگاه خود انتخاب می‌کنید ذخیره شوند. محتوای اسناد برای ذخیره‌سازی به پایگاه داده سرور آپلود نمی‌شود. اتصال مدل هوش مصنوعی در این نسخه غیرفعال است. خدمت‌دهنده: [نام کسب‌وکار]."]],
        ["چه داده‌هایی جمع می‌کنیم", [
          "حساب کاربری: نشانی ایمیل شما برای ورود.",
          "اشتراک: وضعیت و تاریخ پایان پلن، شناسه مشتری و اشتراک در Stripe. اطلاعات کارت را ما نمی‌بینیم و نگه نمی‌داریم.",
          "مصرف: اتصال مدل هوش مصنوعی در این نسخه غیرفعال است و در حال حاضر درخواست یا متن AI ثبت نمی‌شود؛ سازوکار سهمیه‌بندی برای فعال‌سازی احتمالی آینده آماده است.",
          "پرداخت: شناسه رویدادهای وب‌هوک Stripe و شناسه/وضعیت پرداخت زرین‌پال برای جلوگیری از ثبت یا اعطای اعتبار تکراری.",
          "بازخورد: دسته‌بندی، امتیاز، متن پیام، زبان و ایمیل اختیاری برای بررسی گزارش‌ها و پیشنهادها ذخیره می‌شود. محتوای اسناد خصوصی را در بازخورد وارد نکنید.",
          "برای محدودسازی سوءاستفاده، IP خام یا ایمیل در جدول محدودسازی ذخیره نمی‌شود؛ شناسه‌های HMAC‌شده در D1 در پنجره‌های کوتاه (حداکثر حدود یک ساعت) نگهداری و پس از انقضا با پاک‌سازی زمان‌بندی‌شده حذف می‌شوند. این مقدارها دادهٔ تحلیل یا ردیابی نیستند.",
        ]],
        ["چه چیزی را جمع نمی‌کنیم", ["محتوای فایل‌هایی که با ابزارهای محلی (ادغام، تقسیم، فشرده‌سازی، تبدیل، OCR و فضاهای Office) پردازش یا در پوشه انتخابی ذخیره می‌کنید، در D1 یا پایگاه داده اسناد سرور ذخیره نمی‌شود. نام پوشه و شناسه دسترسی آن نیز به سرور ارسال نمی‌شود. تبلیغات نمی‌گذاریم، داده‌هایتان را نمی‌فروشیم و از کوکی‌های ردیابی استفاده نمی‌کنیم."]],
        ["قابلیت‌های هوش مصنوعی", [
          "قابلیت‌های AI در این نسخه آماده‌سازی شده‌اند، اما اتصال به مدل و API غیرفعال است.",
          "در وضعیت فعلی هیچ متن سند، تصویر، پیام یا درخواست کاربر برای تحلیل به ارائه‌دهنده مدل ارسال نمی‌شود.",
          "مترجم قابلیت مستقلی است و فقط با پرچم TRANSLATION_ENABLED و پیکربندی کلید محرمانه Worker فعال می‌شود. هنگام ترجمه، فقط متن واردشده یا متن OCR که کاربر صریحاً برای ترجمه ارسال می‌کند به ارائه‌دهنده خارجی فرستاده می‌شود؛ تصویر، PDF اصلی و فایل‌های دیگر ارسال نمی‌شوند. کاربر پیش از هر درخواست باید رضایت را در رابط مترجم تأیید کند. ترجمه در D1 ذخیره نمی‌شود و فقط شمارنده تعداد درخواست‌ها نگهداری می‌شود.",
        ]],
        ["شرکای فنی ما", ["Cloudflare (میزبانی و اجرای API حساب، بازخورد و پرداخت)، Resend (ارسال ایمیل کد ورود)، Stripe و زرین‌پال (پرداخت). فایل‌های worker و هسته Tesseract و داده زبان OCR ممکن است هنگام اجرای OCR از CDN سرویس jsDelivr بارگذاری شوند؛ این CDN نشانی IP و فراداده اتصال را می‌بیند، اما تصویر یا سندی که OCR می‌کنید برای آن ارسال نمی‌شود. فونت‌ها نیز ممکن است از سرویس‌های فونت شخص ثالث بارگذاری شوند. اتصال AI در این نسخه غیرفعال است و ارائه‌دهنده مدل درخواست دریافت نمی‌کند."]],
        ["ذخیره‌سازی و مدت نگهداری", [
          "روی دستگاه شما: نشانه ورود، زبان انتخابی، پیش‌نویس‌ها و شاخص فضای کاری در حافظه محلی مرورگر ذخیره می‌شوند. این داده‌ها به پروفایل مرورگر وابسته‌اند، نه حساب ورود سایت؛ روی دستگاه مشترک از پروفایل مرورگر یا حساب سیستم جداگانه استفاده کنید.",
          "پوشه انتخابی: پس از انتخاب و تأیید مجوز، شناسه دسترسی پوشه در IndexedDB همان مرورگر نگهداری می‌شود. خروجی‌های تولیدشده و نسخه‌های پشتیبان پیش‌نویس با نام مشخص در پوشه انتخابی قرار می‌گیرند. این فایل‌ها در دستگاه شما هستند و در D1 کپی نمی‌شوند.",
          "مرورگر ممکن است پس از بستن زبانه‌ها، پاک‌کردن داده‌های سایت یا تغییر مجوزها دوباره اجازه دسترسی بخواهد. اگر داده مرورگر پاک شود، می‌توانید پوشه را دوباره متصل و فایل‌های پشتیبان برنامه را بازیابی کنید. قطع اتصال پوشه فایل‌های موجود را حذف نمی‌کند.",
          "در سرور: ایمیل و اطلاعات حساب/اشتراک، سوابق ضروری پرداخت و بازخوردهایی که خودتان ارسال می‌کنید ذخیره می‌شوند. این موارد با محتوای سند متفاوت‌اند و برای اداره حساب و سرویس استفاده می‌شوند.",
          "کد ورود: فقط شناسهٔ ایمیل HMAC‌شده و هش کد یک‌بارمصرف حداکثر ۱۰ دقیقه در D1 نگهداری می‌شود؛ کد خام ذخیره نمی‌شود و با تأیید موفق، رکورد به‌صورت اتمیک مصرف می‌شود. رکوردهای منقضی‌شده در پاک‌سازی زمان‌بندی‌شده حذف می‌شوند.",
          "بازخوردها تا زمانی نگهداری می‌شوند که مدیر محصول طبق سیاست نگهداری داده‌ها آن‌ها را حذف کند؛ ایمیل اختیاری فقط برای پاسخ به گزارش استفاده می‌شود.",
        ]],
        ["حقوق شما", [`می‌توانید با ایمیل ${EMAIL} درخواست دسترسی، اصلاح یا حذف حساب خود را بدهید. در این نسخه، حذف خودکار یا دکمهٔ self-service برای حذف حساب پیاده‌سازی نشده است؛ درخواست حذف باید توسط اپراتور بررسی و دستی اجرا شود. تا زمان اجرای واقعی درخواست، رکورد حساب در D1 باقی می‌ماند. سوابق پرداخت ممکن است برای تطبیق و حسابداری نزد Stripe یا زرین‌پال باقی بماند.`]],
        ["امنیت و کودکان", ["توکن ورود در فضای ذخیره‌سازی محلی مرورگر قرار می‌گیرد و برنامه آن را جداگانه رمزگذاری نمی‌کند؛ هر اسکریپت مخرب اجراشده در مبدأ برنامه می‌تواند برای داده‌های مرورگر خطر ایجاد کند. از دستگاه و پروفایل مرورگر شخصی و به‌روز استفاده کنید. استقرار تولید باید HTTPS را اجباری کند؛ پیکربندی منبع به‌تنهایی وضعیت TLS دامنهٔ زنده را اثبات نمی‌کند. هیچ سامانه‌ای کاملاً بی‌خطر نیست. سرویس برای کودکان زیر ۱۶ سال طراحی نشده است."]],
        ["تغییرات و تماس", [`اگر این سند تغییر مهمی کند، تاریخ بالای آن به‌روز می‌شود. برای سؤال‌ها: ${EMAIL}`]],
      ],
    },
    terms: {
      title: "شرایط استفاده",
      updated: "آخرین به‌روزرسانی: 2026-11-22",
      sections: [
        ["پذیرش شرایط", ["با استفاده از سرویس یا ساخت حساب، این شرایط را می‌پذیرید. اگر موافق نیستید، از سرویس استفاده نکنید. ارائه‌دهنده: [نام کسب‌وکار]."]],
        ["سرویس", ["ابزارهای PDF، تصویر، OCR و محیط‌های Office روی دستگاه اجرا می‌شوند و بر اساس در دسترس بودن ارائه می‌شوند. رابط قابلیت‌های هوش مصنوعی آماده است، اما اتصال مدل در این نسخه غیرفعال است. ممکن است قابلیت‌ها تغییر کنند یا به‌طور موقت در دسترس نباشند."]],
        ["حساب کاربری", ["ورود با ایمیل و کد یک‌بارمصرف انجام می‌شود. مسئول امنیت ایمیل و دستگاه خود هستید. هر حساب برای یک نفر است."]],
        ["استفاده مجاز", ["از سرویس برای کار غیرقانونی، نقض حقوق دیگران، دور زدن سهمیه‌ها و محدودیت‌ها، ارسال خودکار و انبوه درخواست، یا آسیب زدن به سرویس استفاده نکنید."]],
        ["فایل‌ها و نتایج", [
          "فایل‌ها و نتایج متعلق به شماست و شما مسئول داشتن حق پردازش آن‌ها هستید.",
          "نتیجه ابزارها ممکن است کامل نباشد: فشرده‌سازی صفحات را به تصویر تبدیل می‌کند، OCR ممکن است اشتباه کند و خروجی هوش مصنوعی ممکن است نادرست باشد. موارد مهم را بررسی کنید و از فایل‌های اصلی نسخه پشتیبان نگه دارید.",
        ]],
        ["پلن‌ها و پرداخت", [
          "پلن رایگان محدودیت‌های اعلام‌شده در سایت را دارد. پلن حرفه‌ای قابلیت‌های بیشتر را باز می‌کند.",
          "پرداخت با کارت از طریق Stripe اشتراک ماهانه است و تا زمان لغو خودکار تمدید می‌شود. پرداخت با زرین‌پال یک بسته ۳۰ روزه است و تمدید خودکار ندارد. قیمت‌ها هنگام پرداخت نشان داده می‌شود.",
          "ابزارهای فایل روی دستگاه شما اجرا می‌شوند؛ محدودیت تعداد فایل در این ابزارهای محلی از طریق رابط کاربری اعمال می‌شود و مرز امنیتی غیرقابل‌دورزدن نیست. اتصال AI در این نسخه غیرفعال است.",
          `اشتراک کارتی را از «مدیریت یا لغو اشتراک» در سایت لغو کنید؛ معمولاً دسترسی تا پایان دوره پرداخت‌شده باقی می‌ماند. برای هر مشکلی: ${EMAIL}. سیاست بازپرداخت: [سیاست خود را اینجا بنویسید].`,
        ]],
        ["تعلیق و پایان", ["در صورت نقض این شرایط یا سوءاستفاده، می‌توانیم دسترسی را محدود یا حساب را ببندیم. شما هم هر زمان می‌توانید استفاده را متوقف کنید یا حذف حساب را بخواهید."]],
        ["سلب مسئولیت و محدودیت", ["تا حد مجاز قانون، سرویس بدون ضمانت ارائه می‌شود و مسئولیت ما در برابر خسارت‌های غیرمستقیم یا از دست رفتن داده، محدود به مبلغ پرداختی شما در ۱۲ ماه گذشته است. ضمانت‌هایی که قانون اجازه حذفشان را نمی‌دهد محفوظ می‌ماند."]],
        ["تغییرات، قانون حاکم و تماس", [`ممکن است این شرایط را به‌روز کنیم و ادامه استفاده یعنی پذیرش نسخه جدید. قانون حاکم: [کشور/حوزه قضایی]. تماس: ${EMAIL}`]],
      ],
    },
  },
  en: {
    privacy: {
      title: "Privacy Policy",
      updated: "Last updated: 2026-11-22",
      sections: [
        ["Summary", ["Local tools process files in your browser. With your explicit permission, exports and workspace drafts can be saved in a folder you choose on your device. Document contents are not uploaded to a server document database. AI model access is disabled in this release. Operator: [Business name]."]],
        ["What we collect", [
          "Account: your email address, for sign-in.",
          "Subscription: plan status and end date, plus Stripe customer and subscription IDs. We never see or store your card details.",
          "Usage: model access is disabled in this release, so AI prompts and requests are not currently recorded; quota infrastructure is prepared for possible future activation.",
          "Payments: Stripe webhook event IDs and Zarinpal payment references/statuses to prevent duplicate entitlement grants.",
          "Feedback: category, rating, message, language and optional email are stored so the product team can review reports and suggestions. Do not include private document contents.",
          "Abuse prevention: raw IP addresses and email addresses are not stored in the rate-limit table. HMAC identifiers are retained in D1 for short windows (up to about one hour) and removed by scheduled cleanup; they are not used for analytics or tracking.",
        ]],
        ["What we don't collect", ["The contents of files processed or saved using local PDF, image, OCR and Office tools are not stored in D1 or a server document database. The selected folder name and permission handle are not sent to our server. We show no ads, don't sell your data and don't use tracking cookies."]],
        ["AI features", [
          "AI features are prepared in the interface, but model/API access is disabled in this release.",
          "AI Documents and the assistant remain disabled. The standalone translator can be enabled separately. When enabled, only text the user explicitly submits after checking the consent box is sent to the configured provider; original images and files are not uploaded.",
          "The translator is independently gated by the Worker variable TRANSLATION_ENABLED. The translation provider receives only the submitted text after explicit per-request consent. Original images and source files are not sent, and translated content is not stored in D1; only quota counters are stored.",
        ]],
        ["Our service providers", ["Cloudflare (hosting and account, feedback and payment APIs), Resend (sign-in code emails), Stripe and Zarinpal (payments). When OCR is explicitly run, the Tesseract worker, core and language assets may be requested from the jsDelivr CDN. That CDN sees your IP address and connection metadata, but the image or document being processed is not sent to it. Fonts may also load from third-party font services. AI model access is disabled in this release; no model provider receives requests."]],
        ["Storage and retention", [
          "On your device: your sign-in token, language, workspace index and bounded drafts are stored in local browser storage. This data is scoped to the browser profile, not the website login; use separate browser or operating-system profiles on shared devices.",
          "Selected folder: after you choose a folder and grant permission, its handle is stored in IndexedDB in that browser. Exports and app-owned draft snapshots are written directly into the selected folder; these documents are not copied to D1.",
          "The browser may request permission again after tabs close, site data is cleared or permissions change. If browser data is cleared, you can reconnect the folder and import the app-owned snapshots. Disconnecting never deletes existing folder files.",
          "On our server: account and subscription details, necessary payment records and feedback you submit are retained to operate the service. These records are separate from document contents.",
          "Sign-in challenges: D1 stores only an HMAC email identifier and a hash of the one-time code for up to 10 minutes. The raw code is not stored; successful verification consumes the challenge atomically. Expired challenges are removed by scheduled cleanup. Payment reconciliation records and webhook event IDs may be retained longer to prevent duplicate payments and support accounting.",
          "Feedback submissions are retained until deleted under the product team's retention policy; the optional contact email is used only to respond to the report.",
        ]],
        ["Your rights", [`Email ${EMAIL} to request access, correction or deletion of your account. This release does not implement self-service or automatic account deletion; an operator must review and perform deletion manually. The account record remains in D1 until a deletion request is actually completed. Payment records may remain with Stripe or Zarinpal for reconciliation and accounting.`]],
        ["Security and children", ["The sign-in token is stored in browser storage and is not separately encrypted by the app; malicious script running on the app origin could put browser data at risk. Use a personal, up-to-date device and browser profile. Production deployment must enforce HTTPS; source configuration alone cannot verify live domain TLS. No system is perfectly secure. The service is not intended for children under 16."]],
        ["Changes and contact", [`If this document changes materially, the date above is updated. Questions: ${EMAIL}`]],
      ],
    },
    terms: {
      title: "Terms of Use",
      updated: "Last updated: 2026-11-22",
      sections: [
        ["Acceptance", ["By using the service or creating an account you accept these terms. If you disagree, please don't use the service. Operator: [Business name]."]],
        ["The service", ["PDF, image, OCR and Office tools run on the device and are provided as-is and as available. The AI interface is prepared, but model access is disabled in this release. Features may change or be temporarily unavailable."]],
        ["Your account", ["Sign-in uses email and a one-time code. You are responsible for the security of your email and device. One account is for one person."]],
        ["Acceptable use", ["Don't use the service for anything illegal, to infringe others' rights, to bypass quotas or limits, to send automated bulk requests, or to harm the service."]],
        ["Files and results", [
          "Your files and results belong to you, and you are responsible for having the right to process them.",
          "Results may be imperfect: compression turns pages into images, OCR can make mistakes and AI output can be wrong. Check anything important and keep backups of your originals.",
        ]],
        ["Plans and payments", [
          "The free plan has the limits shown on the site. Pro unlocks more features.",
          "Card payments through Stripe are a monthly subscription that renews automatically until cancelled. Zarinpal payments are a one-off 30-day pass and don't renew. Prices are shown at checkout.",
          "Local file tools run on your device; file-count restrictions for these tools are interface-level controls, not tamper-proof security boundaries. AI model access is disabled in this release.",
          `Cancel a card subscription from “Manage or cancel subscription” on the site; access ordinarily continues to the end of the paid period. For any problem, email ${EMAIL}. Refund policy: [write your policy here].`,
        ]],
        ["Suspension and ending", ["If you breach these terms or abuse the service, we may restrict access or close your account. You may stop using the service or ask us to delete your account at any time."]],
        ["Disclaimer and liability", ["To the extent allowed by law, the service is provided without warranties, and our liability for indirect damages or loss of data is limited to what you paid us in the past 12 months. Warranties that cannot be excluded by law remain."]],
        ["Changes, governing law and contact", [`We may update these terms; continued use means you accept the new version. Governing law: [country/jurisdiction]. Contact: ${EMAIL}`]],
      ],
    },
  },
};

export default function Legal({ lang, doc }: { lang: Lang; doc: "privacy" | "terms" }) {
  const d = D[lang][doc];
  return (
    <article className="about legal">
      <h2 className="about-title">{d.title}</h2>
      <p className="muted" dir="ltr" style={{ textAlign: "start" }}>{d.updated}</p>
      {d.sections.map(([h, ps]) => (
        <section key={h}>
          <h3>{h}</h3>
          {ps.map((p) => <p key={p}>{p}</p>)}
        </section>
      ))}
    </article>
  );
}

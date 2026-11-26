# گزارش فاز نهم PDF AI Tools — Local-First Device Folder

## خلاصه

در این فاز قابلیت انتخاب پوشهٔ شخصی توسط کاربر اضافه شد. کاربر فقط پس از فشردن دکمهٔ اتصال، پوشه را از انتخاب‌گر بومی مرورگر انتخاب و مجوز خواندن/نوشتن را تأیید می‌کند. برنامه به‌صورت خودکار هیچ پوشه‌ای را جست‌وجو یا انتخاب نمی‌کند.

## رفتار ذخیره‌سازی

- در مرورگرهای پشتیبان و در HTTPS یا localhost، `FileSystemDirectoryHandle` در IndexedDB محلی و جداگانه نگهداری می‌شود.
- خروجی‌های PDF، DOCX، XLSX، PPTX، TXT، ZIP، JSON backup و CSV بازخورد مدیریتی ابتدا در پوشهٔ انتخابی ذخیره می‌شوند، در صورتی که مجوز نوشتن هنوز فعال باشد.
- نام خروجی‌ها به‌صورت یکتا انتخاب می‌شود تا فایل موجود کاربر ناخواسته بازنویسی نشود.
- پیش‌نویس‌های داخلی Word، Excel، PowerPoint و AI Documents همچنان در حافظهٔ محلی مرورگر برای کار سریع نگهداری می‌شوند و هم‌زمان به شکل فایل‌های برنامه‌ای `pdf-ai-tools-draft-*.pdat.json` در پوشهٔ انتخابی mirror می‌شوند.
- فایل‌های `.pdat.json` snapshot داخلی برای بازیابی و ادامهٔ ویرایش در PDF AI Tools هستند؛ برای داشتن فایل استاندارد DOCX/XLSX/PPTX از گزینهٔ Export/Download همان محیط استفاده کنید. این خروجی‌های استاندارد نیز در پوشهٔ انتخابی ذخیره می‌شوند.
- در صورت نبود API، عدم اتصال پوشه یا نیاز به تأیید مجدد مجوز، برنامه از مسیر عادی ذخیره/دانلود مرورگر استفاده می‌کند و در صورت fallback مجوز پیام می‌دهد.
- دکمهٔ قطع اتصال فقط handle را از IndexedDB پاک می‌کند؛ هیچ فایلی را از پوشهٔ کاربر حذف نمی‌کند.

## حریم خصوصی و جداسازی داده

- محتوای اسناد و فایل‌های خروجی به Worker یا D1 ارسال نمی‌شود و دیتابیس سرور برای محتوای اسناد استفاده نمی‌شود.
- D1 همچنان برای داده‌های حساب، اشتراک/پرداخت و بازخوردهایی که کاربر صریحاً ارسال می‌کند استفاده می‌شود.
- هوش مصنوعی طبق تصمیم محصول غیرفعال باقی مانده است: `AI_CONNECTION_ENABLED = false` و Worker `AI_ENABLED = "false"`. هیچ متن یا تصویری برای تحلیل به ارائه‌دهندهٔ AI ارسال نمی‌شود.
- handle پوشه و پیش‌نویس‌های محلی به پروفایل مرورگر و origin وابسته‌اند، نه حساب ورود سایت. روی دستگاه مشترک، هر نفر باید از حساب سیستم‌عامل یا پروفایل مرورگر جداگانه استفاده کند.
- snapshotهای پوشه و حافظهٔ مرورگر توسط برنامه به‌صورت جداگانه رمزگذاری نمی‌شوند. برای اسناد حساس از دستگاه و حساب سیستم محافظت‌شده استفاده کنید.
- پیشنهاد می‌شود پوشه‌ای اختصاصی به نام `PDF AI Tools` بسازید و همان را انتخاب کنید؛ کل Documents یا Desktop را متصل نکنید.

## سازگاری مرورگر

- File System Access API در همهٔ مرورگرها در دسترس نیست؛ به HTTPS یا localhost و اقدام مستقیم کاربر نیاز دارد. مجوز پوشه می‌تواند پس از بستن مرورگر یا تغییر تنظیمات منقضی/لغو شود و در My Workspace امکان درخواست دوبارهٔ مجوز وجود دارد.
- روی مرورگرهای فاقد انتخاب‌گر پوشه یا دستگاه‌هایی که API را ارائه نمی‌کنند، ذخیره/دانلود معمول دستگاه به‌عنوان fallback باقی می‌ماند. پشتیبانی موبایل به مرورگر و نسخهٔ آن وابسته است و نباید به‌عنوان اتصال پوشهٔ دائمی در همهٔ موبایل‌ها وعده داده شود.
- اگر داده‌های سایت از تنظیمات مرورگر پاک شوند، handle و index محلی ممکن است حذف شوند؛ snapshotهای باقی‌مانده در پوشه را می‌توان پس از اتصال دوباره از My Workspace وارد کرد.

## فایل‌های مهم

- `src/core/device-folder.ts` و `src/core/device-folder.js`: انتخاب پوشه، مجوز، ذخیرهٔ handle، نوشتن خروجی، snapshot و fallback.
- `src/core/local-workspace.ts` و `src/core/local-workspace.js`: ذخیرهٔ محلی، mirror کردن پیش‌نویس‌ها و بازیابی snapshotها.
- `src/ui/WorkspaceLibrary.tsx` و `.js`: UI اتصال/مدیریت پوشه، همگام‌سازی، import و disconnect.
- `src/ui/App.tsx` و `.js`: کارت اتصال پوشه در داشبورد و پیام‌های ذخیره.
- خروجی‌های PDF/Word/Excel/PowerPoint/Scan Center/AI Documents و CSV بازخورد به helper مشترک ذخیرهٔ پوشه متصل شده‌اند.

## تست‌های اجراشده در محیط ساخت

موفق:

- `node tests/device_folder_check.mjs`
- `node tests/device_folder_runtime_check.mjs`
- `node tests/local_workspace_runtime_check.mjs`
- `python tests/sqlite_security_check.py`
- `python tests/word_workspace_check.py`
- `python tests/excel_workspace_check.py`
- `python tests/powerpoint_workspace_check.py`
- `python tests/document_ai_check.py`
- `python tests/workflow_check.py`
- `python tests/local_workspace_check.py`
- `python tests/device_folder_integration_check.py`
- `python tests/device_folder_privacy_check.py`
- TypeScript no-emit check برای `device-folder.ts` و `local-workspace.ts` با TypeScript محلی.
- بررسی transpile فایل‌های TS/TSX تغییریافته و `node --check` فایل‌های JavaScript متناظر.

Build کامل Vite در محیط ساخت این بسته اجرا نشد، چون وابستگی‌های کامل npm در این محیط موجود نبودند و دریافت از registry قابل اتکا نبود. بنابراین Build نهایی باید در ویندوز کاربر اجرا شود.

## نصب و آزمون روی ویندوز

```powershell
cd "D:\engine\PDF editor\pdf-ai-tools"
npm test
npm run build
npm run preview
```

سپس در My Workspace پوشهٔ اختصاصی را انتخاب کنید، اجازهٔ نوشتن بدهید، یک سند Word بسازید و خروجی DOCX بگیرید. بررسی کنید فایل در پوشهٔ انتخابی قرار گرفته باشد. بعد دسترسی پوشه را از مرورگر لغو/منقضی کنید یا روی یک مرورگر پشتیبانی‌نشده آزمایش کنید تا مسیر fallback دانلود بررسی شود.

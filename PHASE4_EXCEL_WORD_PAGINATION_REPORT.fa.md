# گزارش فاز چهارم PDF AI Tools

## خلاصه

این نسخه بر اساس ZIP فاز سوم Word Workspace ساخته شده است و دو تغییر اصلی دارد:

1. رفع تجربه صفحه‌بندی Word هنگام تایپ متن طولانی.
2. اضافه شدن Excel Workspace برای کارهای پایه صفحه‌گسترده.

## اصلاح Word Workspace

- پیش‌نمایش صفحه‌های A4 با فاصله بصری بین صفحات در حین تایپ.
- نمایش شمارنده تخمینی صفحه.
- تنظیم اندازه پیش‌نمایش برای صفحه‌های باریک/موبایل.
- چاپ و خروجی PDF همچنان از موتور چاپ مرورگر استفاده می‌کند و صفحه‌بندی واقعی را انجام می‌دهد.
- محدودیت: DOM ویرایشگر هنوز یک جریان پیوسته است؛ این نسخه موتور کامل صفحه‌بندی Word با انتقال بلوک‌ها و حاشیه مستقل هر صفحه نیست.

## Excel Workspace

- تب مستقل فارسی/انگلیسی و مسیر `/#excel`.
- باز کردن CSV، TSV و XLSX (اولین Worksheet).
- ویرایش سلول‌ها، نوار فرمول، جست‌وجو، افزودن ردیف و ستون.
- خروجی XLSX ساده تک‌شیت و CSV.
- محاسبه محدود فرمول‌های arithmetic و `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT` روی range.
- فرمول‌ها با allow-list محدود پردازش می‌شوند؛ از `eval` استفاده نشده است.
- سقف فایل ۱۵ MB، سقف ZIP بازشده ۸۰ MB، حداکثر ۵۰۰ ردیف و ۱۰۰ ستون.
- محدودیت: چندشیتی، حفظ قالب‌بندی پیشرفته، نمودار، ماکرو و سازگاری کامل فرمول‌های Excel هنوز پشتیبانی نمی‌شوند.

## تست‌های انجام‌شده در این محیط

- `npm test`: موفق؛ تست‌های امنیت SQLite، OOXML Word و smoke-check فاز Excel.
- بررسی نحوی TypeScript/TSX با compiler موجود: ۳۰ فایل، صفر diagnostic نحوی.
- بررسی package ZIP و ساختار پروژه: انجام می‌شود پیش از تحویل.

## تستی که روی سیستم توسعه باید تکمیل شود

وابستگی‌های npm در محیط ساخت این بسته قابل دریافت نبودند؛ بنابراین Build کامل Vite/TypeScript با dependencyهای واقعی در این محیط تأیید نشده است. پس از استخراج و جایگزینی نسخه:

```powershell
npm install --include=dev
npm test
npm run build
npm run preview
```

سپس مرورگر را روی `http://localhost:4173/#word` باز کنید و متن طولانی وارد کنید؛ باید مرز صفحه‌های A4 و شمارنده صفحه را ببینید. بعد `http://localhost:4173/#excel` را باز کنید، یک CSV یا XLSX آزمایشی وارد کنید، سلول را تغییر دهید، یک فرمول ساده مانند `=A1+B1` یا `=SUM(A1:A3)` وارد کنید و خروجی XLSX را در Excel یا LibreOffice بازبینی کنید.

## وضعیت

- Word page preview: Implemented; local visual verification pending.
- Excel basic workspace: Implemented; complete Vite build and real Excel round-trip pending.
- Production build: Not claimed as verified in this environment.

# گزارش اصلاح Build فاز دهم — رفع خطای TypeScript در Excel

## علت

در `evaluateFormula`، تابع `formulaTokens` نوع `string[] | null` برمی‌گرداند. هرچند null پیش از شروع پارسر بررسی شده بود، توابع بازگشتی داخلی (`primary`، `multiplication` و `addition`) متغیر بیرونی `tokens` را capture می‌کردند. TypeScript 5.9 در حالت strict، narrowing بیرون closure را داخل این توابع تضمین نمی‌کند و ۸ خطای TS18047 گزارش می‌داد.

## اصلاح

- در `src/ui/ExcelWorkspace.tsx` خروجی token parser به یک آرایهٔ صریحاً non-null تبدیل شده است: null به آرایهٔ خالی تبدیل می‌شود و آرایهٔ خالی به‌عنوان فرمول نامعتبر رد می‌شود.
- فایل runtime متناظر `src/ui/ExcelWorkspace.js` نیز همگام شده است.
- یک regression check به `tests/excel_workspace_check.py` افزوده شد تا این قرارداد در نسخه‌های بعد حفظ شود.
- رفتار محاسبهٔ فرمول‌ها، allow-list، جلوگیری از circular reference و خروجی XLSX تغییر نکرده است.

## دستورهای بررسی روی ویندوز

پس از جایگزینی فایل‌ها و حفظ `node_modules` فعلی:

```powershell
npm test
npm run build
npm run preview
```

`npm run preview` را فقط بعد از موفقیت Build اجرا کنید؛ خطای قبلی `dist does not exist` پیامد مستقیم شکست Build بود.

## وضعیت شواهد

خروجی ارائه‌شده توسط کاربر نشان می‌دهد تمام زیرآزمون‌های `npm test` پس از نصب وابستگی‌ها موفق شده‌اند. اصلاح فعلی هشت خطای strict TypeScript را هدف می‌گیرد. در محیط تحویل، بررسی‌های ایستا و تست‌های Python اجرا می‌شوند؛ Build کامل با همان TypeScript 5.9.3 و وابستگی‌های نصب‌شدهٔ ویندوز کاربر باید در سیستم کاربر تأیید شود.

## تست‌های انجام‌شده در محیط آماده‌سازی

- `python tests/excel_workspace_check.py`: موفق، شامل regression check جدید.
- `python tests/sqlite_security_check.py`: موفق.
- `python tests/word_workspace_check.py`: موفق.
- `python tests/powerpoint_workspace_check.py`: موفق.
- `python tests/document_ai_check.py`: موفق.
- `python tests/workflow_check.py`: موفق.
- `python tests/local_workspace_check.py`: موفق.
- `python tests/device_folder_integration_check.py`: موفق.
- `python tests/device_folder_privacy_check.py`: موفق.
- `python tests/plan_entitlement_check.py`: موفق.
- Type-check ایزولهٔ پارسر بازگشتی با TypeScript سراسری 5.8.3 در strict mode: موفق.
- `node --check src/ui/ExcelWorkspace.js`: موفق.

Build کامل پروژه در این محیط انجام نشد، چون وابستگی‌های npm پروژه (React، fflate، pdf-lib و غیره) در این محیط نصب نیستند. کاربر قبلاً در لاگ خود موفقیت همهٔ `npm test` را پس از `npm install --include=dev` ثبت کرده بود؛ اصلاح فعلی فقط خطای strict TypeScript در parser فرمول Excel را هدف می‌گیرد.

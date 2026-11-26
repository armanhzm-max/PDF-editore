# گزارش اصلاح خطاهای Build – PDF AI Tools Phase 1

## خطاهای اصلاح‌شده

- خطاهای TS2322 مربوط به قرار دادن `Uint8Array<ArrayBufferLike>` در `File` و `Blob` در ابزارهای تبدیل تصویر به PDF، OCR، فشرده‌سازی، ادغام، تقسیم و ویرایشگر PDF اصلاح شد.
- تابع مشترک `toOwnedArrayBuffer` در `src/core/bytes.ts` اضافه شد. این تابع داده‌ها را در یک `ArrayBuffer` مستقل کپی می‌کند؛ بنابراین به‌جای cast ناامن، نوع مناسب DOM برای `BlobPart`/`FilePart` تولید می‌شود.
- ویژگی `dir` از عنصر SVG در `src/ui/Hero.tsx` حذف شد؛ این ویژگی در تایپ `SVGProps<SVGSVGElement>` پروژه تعریف نشده بود و برای SVG تزئینی ضروری نیست.

## تست‌هایی که در این محیط اجرا شدند

- `npm run test:security` – موفق؛ تمام بررسی‌های SQLite گزارش PASS دادند.
- TypeScript 5.8.3 – تست مستقل helper و استفاده از خروجی آن در `File` و `Blob` با `--strict` موفق بود.
- Build کامل پروژه اجرا نشد؛ دریافت وابستگی‌های npm در محیط اجرا به timeout خورد و `node_modules` کامل در دسترس نبود.

## دستورهای لازم در ویندوز

از ریشه پروژه اجرا کنید:

```powershell
npm install
npm run build
npm run test:security
```

نکته: دستور تست باید دقیقاً `npm run test:security` باشد؛ اگر حرف فارسی یا کاراکتر دیگری به انتهای آن بچسبد، npm آن را نام اسکریپت جداگانه تلقی می‌کند.

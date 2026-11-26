const EXT = { png: "png", jpeg: "jpg", webp: "webp" };
const tool = {
    id: "image-convert",
    name: { fa: "تبدیل و کم‌حجم کردن تصویر", en: "Convert & resize image" },
    description: { fa: "فرمت، کیفیت و اندازه تصویر را تغییر می‌دهد.", en: "Change image format, quality and size." },
    category: "image", accepts: ["image/png", "image/jpeg", "image/webp"], multiple: true, plan: "free", maxFilesFree: 1, maxFilesPro: 20, usesAI: false,
    options: [
        { key: "format", label: { fa: "فرمت خروجی", en: "Output format" }, default: "webp", choices: ["png", "jpeg", "webp"] },
        { key: "quality", label: { fa: "کیفیت (۰.۱ تا ۱)", en: "Quality (0.1–1)" }, default: "0.8" },
        { key: "maxWidth", label: { fa: "حداکثر عرض به پیکسل (۰ = بدون تغییر)", en: "Max width in px (0 = keep)" }, default: "0" },
    ],
    async run(files, { options }) {
        const format = options.format;
        const quality = Number(options.quality);
        const maxWidth = Number(options.maxWidth);
        if (!Object.hasOwn(EXT, format) || !Number.isFinite(quality) || quality < 0.1 || quality > 1 || !Number.isFinite(maxWidth) || maxWidth < 0 || maxWidth > 10_000) {
            throw new Error("bad_option");
        }
        const out = [];
        for (const file of files) {
            const bitmap = await createImageBitmap(file);
            const canvas = document.createElement("canvas");
            try {
                const scale = maxWidth && bitmap.width > maxWidth ? maxWidth / bitmap.width : 1;
                canvas.width = Math.max(1, Math.round(bitmap.width * scale));
                canvas.height = Math.max(1, Math.round(bitmap.height * scale));
                const context = canvas.getContext("2d");
                if (!context)
                    throw new Error("canvas_unavailable");
                context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
                const mime = `image/${format}`;
                const blob = await new Promise((resolve, reject) => {
                    canvas.toBlob((value) => value ? resolve(value) : reject(new Error("conversion_failed")), mime, quality);
                });
                const baseName = file.name.replace(/\.[^.]+$/, "");
                out.push(new File([blob], `${baseName}.${EXT[format]}`, { type: mime }));
            }
            finally {
                bitmap.close();
                canvas.width = 0;
                canvas.height = 0;
            }
        }
        return { files: out };
    },
};
export default tool;

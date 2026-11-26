import { pdfjs } from "../../core/pdfjs";
import type { Tool } from "../../core/types";

async function extractText(file: File): Promise<string> {
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  try {
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const c = await (await pdf.getPage(i)).getTextContent();
      text += c.items.map((it: any) => it.str).join(" ") + "\n";
    }
    return text;
  } finally {
    await pdf.destroy();
  }
}

// استخراج متن محلی؛ فقط متن به Worker می‌رود. سهمیه روزانه را Worker اعمال می‌کند.
const tool: Tool = {
  id: "pdf-summarize",
  name: { fa: "خلاصه‌سازی PDF با AI", en: "AI PDF summary" },
  description: { fa: "متن PDF را استخراج و خلاصه می‌کند (نیاز به ورود).", en: "Extract and summarize PDF text (sign-in required)." },
  category: "ai", accepts: ["application/pdf"], multiple: false, plan: "free", maxFilesFree: 1, maxPdfPages: 50, maxPdfPagesPro: 300, usesAI: true,
  options: [{ key: "language", label: { fa: "زبان خلاصه", en: "Summary language" }, default: "auto", choices: ["auto", "fa", "en"] }],
  async run(files, { callAI, options }) {
    const text = (await extractText(files[0])).slice(0, 60000);
    const lang = options.language === "fa" ? "in Persian" : options.language === "en" ? "in English" : "in the document's language";
    return { text: await callAI!(`Summarize this document ${lang} in a few short paragraphs.`, text) };
  },
};
export default tool;

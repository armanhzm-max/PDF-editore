export type Plan = "free" | "pro";
export type L10n = { fa: string; en: string };

export interface ToolOption {
  key: string;
  label: L10n;
  default: string;
  choices?: string[]; // اگر باشد، لیست انتخابی نمایش داده می‌شود
}

export interface ToolContext {
  options: Record<string, string>;
  callAI?: (prompt: string, text: string) => Promise<string>;
}

export interface ToolResult { files?: File[]; text?: string }

export interface Tool {
  id: string;
  name: L10n;
  description: L10n;
  category: "pdf" | "image" | "ai" | "files";
  accepts: string[];
  multiple: boolean;
  plan: Plan;               // ابزار کاملاً مخصوص پرو
  maxFilesFree?: number;    // سقف تعداد فایل در پلن رایگان
  maxFilesPro?: number;     // سقف تعداد فایل در پلن حرفه‌ای
  maxPdfPages?: number;     // سقف صفحات پلن رایگان
  maxPdfPagesPro?: number;  // سقف صفحات پلن حرفه‌ای     // سقف صفحات PDF برای کنترل مصرف حافظه مرورگر
  usesAI: boolean;
  /** Destructive or sensitive tools must be confirmed immediately before local execution. */
  requiresConfirmation?: boolean;
  options?: ToolOption[];
  run(files: File[], ctx: ToolContext): Promise<ToolResult>;
}

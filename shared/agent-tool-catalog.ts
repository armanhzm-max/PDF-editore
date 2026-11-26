/** Server-authoritative catalogue of browser-local tools exposed to a future AI agent.
 * The model may request only these operations. It cannot submit executable code,
 * filesystem paths, URLs, or arbitrary JSON schemas.
 */
export type AgentToolOption = {
  type: "string";
  description: string;
  enum?: readonly string[];
  maxLength?: number;
};
export type AgentToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
};

const fileList = {
  type: "array",
  items: { type: "string", minLength: 1, maxLength: 180 },
  minItems: 1,
  maxItems: 50,
  description: "Exact names of files already present in the user's local assistant workspace.",
};

export const AGENT_TOOL_CATALOG: readonly AgentToolDefinition[] = [
  {
    name: "image-convert",
    description: "Convert selected local images to PNG, JPEG, or WebP and optionally resize them.",
    input_schema: { type: "object", properties: {
      files: fileList,
      format: { type: "string", enum: ["png", "jpeg", "webp"] },
      quality: { type: "string", maxLength: 8, description: "A decimal from 0.1 to 1.0." },
      maxWidth: { type: "string", maxLength: 6, description: "An integer from 0 to 10000 pixels." },
    }, required: ["files"], additionalProperties: false },
  },
  {
    name: "images-to-pdf",
    description: "Combine selected local images into one PDF in the requested order.",
    input_schema: { type: "object", properties: { files: fileList }, required: ["files"], additionalProperties: false },
  },
  {
    name: "ocr",
    description: "Recognize text from local images or scanned PDFs using the browser OCR engine.",
    input_schema: { type: "object", properties: {
      files: fileList,
      lang: { type: "string", enum: ["fas+eng", "fas", "eng"] },
    }, required: ["files"], additionalProperties: false },
  },
  {
    name: "pdf-compress",
    description: "Compress local PDFs by rasterizing pages; text may no longer be selectable.",
    input_schema: { type: "object", properties: {
      files: fileList,
      quality: { type: "string", enum: ["low", "medium", "high"] },
    }, required: ["files"], additionalProperties: false },
  },
  {
    name: "pdf-merge",
    description: "Merge selected local PDF files in their given order.",
    input_schema: { type: "object", properties: { files: fileList }, required: ["files"], additionalProperties: false },
  },
  {
    name: "pdf-split",
    description: "Split a local PDF into page ranges or individual pages.",
    input_schema: { type: "object", properties: {
      files: { ...fileList, maxItems: 1 },
      ranges: { type: "string", maxLength: 120, description: "Page ranges such as 1-3,5 or the value each." },
    }, required: ["files"], additionalProperties: false },
  },
] as const;

const CATALOG_BY_NAME = new Map(AGENT_TOOL_CATALOG.map((tool) => [tool.name, tool]));
export function getAgentToolDefinition(name: string): AgentToolDefinition | undefined {
  return CATALOG_BY_NAME.get(name);
}

export function validateAgentToolInput(name: string, input: unknown, availableFiles: readonly string[]): boolean {
  const definition = getAgentToolDefinition(name);
  if (!definition || !input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  const allowedKeys = new Set(Object.keys(definition.input_schema.properties));
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 50) return false;
  if (name === "pdf-split" && value.files.length !== 1) return false;
  const known = new Set(availableFiles);
  if (value.files.some((file) => typeof file !== "string" || file.length < 1 || file.length > 180 || !known.has(file))) return false;
  for (const [key, raw] of Object.entries(value)) {
    if (key === "files") continue;
    if (typeof raw !== "string" || raw.length > 120) return false;
    if (key === "format" && !["png", "jpeg", "webp"].includes(raw)) return false;
    if (key === "quality" && name === "pdf-compress" && !["low", "medium", "high"].includes(raw)) return false;
    if (key === "quality" && name === "image-convert" && (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(raw) || Number(raw) < 0.1 || Number(raw) > 1)) return false;
    if (key === "maxWidth" && (!/^\d{1,5}$/.test(raw) || Number(raw) > 10000)) return false;
    if (key === "lang" && !["fas+eng", "fas", "eng"].includes(raw)) return false;
    if (key === "ranges" && (raw.length > 120 || !/^(?:each|\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)$/.test(raw))) return false;
  }
  return true;
}

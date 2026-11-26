const MIME_EXTENSIONS: Record<string, string[]> = {
  "application/pdf": [".pdf"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/webp": [".webp"],
};

export function resolveAcceptedMime(file: Pick<File, "name" | "type">, accepts: readonly string[]): string | null {
  const name = file.name.toLowerCase();
  const extensionMatch = Object.entries(MIME_EXTENSIONS)
    .find(([mime, extensions]) => accepts.includes(mime) && extensions.some((extension) => name.endsWith(extension)))?.[0] ?? null;
  const declared = file.type.split(";")[0].trim().toLowerCase();

  if (declared && declared !== "application/octet-stream") {
    if (!accepts.includes(declared)) return null;
    const extensions = MIME_EXTENSIONS[declared];
    if (extensions && !extensions.some((extension) => name.endsWith(extension))) return null;
    return declared;
  }
  return extensionMatch;
}

export async function hasExpectedFileSignature(file: Pick<File, "slice">, expectedMime: string): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);

  switch (expectedMime) {
    case "application/pdf":
      return bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/webp":
      return bytes.length >= 12
        && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
        && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
    default:
      return false;
  }
}

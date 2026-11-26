/**
 * Copy bytes into an ArrayBuffer-owned Uint8Array so the result can safely be
 * used as a BlobPart/FilePart with current TypeScript DOM definitions.
 *
 * Some libraries expose Uint8Array<ArrayBufferLike>; BlobPart requires an
 * ArrayBuffer-backed view. A fresh ArrayBuffer also avoids retaining unrelated
 * memory from a larger underlying buffer.
 */
export function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

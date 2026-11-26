/**
 * Explicit, local-only workspace folder integration.
 * The app never chooses a path on the user's behalf: connectDeviceFolder()
 * opens the native picker only after a user click. The handle is stored locally
 * in IndexedDB. No folder content or handle is sent to the Worker/server.
 */
export type FolderPermission = "granted" | "prompt" | "denied" | "unknown";
export type DeviceFolderStatus = {
  supported: boolean;
  connected: boolean;
  name: string | null;
  permission: FolderPermission;
};
export type FolderWriteResult = "saved" | "not-connected" | "permission-needed" | "unsupported" | "failed";

export type DraftSnapshotRecord = {
  id: string;
  kind: "word" | "excel" | "ppt" | "documents";
  name: string;
  preview: string;
  createdAt: number;
  updatedAt: number;
  bytes: number;
  payloadJson: string;
};

interface WritableLike {
  write(data: Blob | BufferSource | string): Promise<void>;
  close(): Promise<void>;
  abort?(): Promise<void>;
}
interface FileHandleLike {
  getFile(): Promise<File>;
  createWritable(): Promise<WritableLike>;
}
interface DirectoryHandleLike {
  name: string;
  queryPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(options: { mode: "readwrite" }): Promise<PermissionState>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  removeEntry(name: string): Promise<void>;
  entries(): AsyncIterableIterator<[string, FileHandleLike | DirectoryHandleLike]>;
}
type PickerWindow = Window & {
  showDirectoryPicker?: (options: { id: string; mode: "readwrite" }) => Promise<DirectoryHandleLike>;
};

const HANDLE_DB = "pdf-ai-tools-device-folder";
const HANDLE_DB_VERSION = 1;
const HANDLE_STORE = "settings";
const HANDLE_KEY = "workspace-directory";
const DRAFT_PREFIX = "pdf-ai-tools-draft-";
const DRAFT_SUFFIX = ".pdat.json";
const MAX_DRAFT_FILE_BYTES = 4 * 1024 * 1024 + 32 * 1024;
let cachedHandle: DirectoryHandleLike | null = null;

function pickerWindow(): PickerWindow { return window as PickerWindow; }
export function supportsPersistentFolderAccess(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === true && typeof pickerWindow().showDirectoryPicker === "function" && typeof indexedDB !== "undefined";
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("folder_handle_storage_unavailable"));
    const request = indexedDB.open(HANDLE_DB, HANDLE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE)) db.createObjectStore(HANDLE_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("folder_handle_storage_failed"));
    request.onblocked = () => reject(new Error("folder_handle_storage_blocked"));
  });
}

async function storeHandle(handle: DirectoryHandleLike): Promise<void> {
  const db = await openHandleDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readwrite");
      tx.objectStore(HANDLE_STORE).put({ key: HANDLE_KEY, handle });
      tx.oncomplete = () => { cachedHandle = handle; resolve(); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("folder_handle_storage_failed"));
    });
  } finally { db.close(); }
}

async function loadHandle(): Promise<DirectoryHandleLike | null> {
  if (cachedHandle) return cachedHandle;
  try {
    const db = await openHandleDb();
    try {
      return await new Promise<DirectoryHandleLike | null>((resolve, reject) => {
        const request = db.transaction(HANDLE_STORE, "readonly").objectStore(HANDLE_STORE).get(HANDLE_KEY);
        request.onsuccess = () => {
          cachedHandle = (request.result?.handle as DirectoryHandleLike | undefined) ?? null;
          resolve(cachedHandle);
        };
        request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
  } catch { return null; }
}

function mapPermission(value: PermissionState | undefined): FolderPermission {
  return value === "granted" || value === "prompt" || value === "denied" ? value : "unknown";
}

export async function getDeviceFolderStatus(): Promise<DeviceFolderStatus> {
  const supported = supportsPersistentFolderAccess();
  if (!supported) return { supported: false, connected: false, name: null, permission: "unknown" };
  const handle = await loadHandle();
  if (!handle) return { supported: true, connected: false, name: null, permission: "unknown" };
  let permission: FolderPermission = "unknown";
  try { permission = mapPermission(await handle.queryPermission({ mode: "readwrite" })); }
  catch { permission = "unknown"; }
  return { supported: true, connected: true, name: handle.name || null, permission };
}

export async function connectDeviceFolder(): Promise<DeviceFolderStatus> {
  if (!supportsPersistentFolderAccess()) throw new Error("folder_access_unsupported");
  const picker = pickerWindow().showDirectoryPicker;
  if (!picker) throw new Error("folder_access_unsupported");
  // This must be called directly from a user-initiated click handler.
  const handle = await picker.call(window, { id: "pdf-ai-tools-workspace", mode: "readwrite" });
  let permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") permission = await handle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") throw new Error("folder_permission_denied");
  await storeHandle(handle);
  return { supported: true, connected: true, name: handle.name || null, permission: "granted" };
}

/** Call this only from a button click; browsers may require fresh user activation. */
export async function requestDeviceFolderPermission(): Promise<DeviceFolderStatus> {
  // getDeviceFolderStatus preloads the handle when My Workspace renders. Reuse
  // this in-memory handle so the browser permission request happens immediately
  // inside the user's click activation, without waiting for IndexedDB first.
  const handle = cachedHandle ?? await loadHandle();
  if (!handle) throw new Error("folder_not_connected");
  const permission = await handle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") throw new Error("folder_permission_denied");
  return { supported: true, connected: true, name: handle.name || null, permission: "granted" };
}

export async function disconnectDeviceFolder(): Promise<void> {
  const db = await openHandleDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, "readwrite");
      tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("folder_handle_storage_failed"));
    });
  } finally { db.close(); }
  cachedHandle = null;
  // Existing files in the user's folder are intentionally never deleted here.
}

function safeFilename(value: string): string {
  const leaf = value.split(/[\\/]/).pop() ?? "file";
  const safe = leaf.replace(/[<>:"|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").trim();
  return (safe || "file").slice(0, 160);
}

async function uniqueFileName(handle: DirectoryHandleLike, requested: string): Promise<string> {
  const safe = safeFilename(requested);
  try { await handle.getFileHandle(safe); }
  catch (error) { if ((error as DOMException)?.name === "NotFoundError") return safe; throw error; }
  const dot = safe.lastIndexOf(".");
  const base = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  for (let index = 2; index <= 999; index += 1) {
    const candidate = `${base} (${index})${ext}`;
    try { await handle.getFileHandle(candidate); }
    catch (error) { if ((error as DOMException)?.name === "NotFoundError") return candidate; throw error; }
  }
  throw new Error("folder_filename_conflict");
}

export async function writeBlobToConnectedFolder(filename: string, blob: Blob, overwrite = false, notify = true): Promise<FolderWriteResult> {
  if (!supportsPersistentFolderAccess()) return "unsupported";
  const handle = await loadHandle();
  if (!handle) return "not-connected";
  let permission: PermissionState;
  try { permission = await handle.queryPermission({ mode: "readwrite" }); }
  catch { return "permission-needed"; }
  if (permission !== "granted") return "permission-needed";
  try {
    const safeName = overwrite ? safeFilename(filename) : await uniqueFileName(handle, filename);
    const fileHandle = await handle.getFileHandle(safeName, { create: true });
    const writable = await fileHandle.createWritable();
    try { await writable.write(blob); await writable.close(); }
    catch (error) { try { await writable.abort?.(); } catch { /* best effort */ } throw error; }
    if (notify && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("pdat:folder-saved", { detail: { filename: safeName } }));
    return "saved";
  } catch { return "failed"; }
}

export function workspaceDraftFilename(id: string): string {
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "draft";
  return `${DRAFT_PREFIX}${safeId}${DRAFT_SUFFIX}`;
}

export async function writeWorkspaceDraftSnapshot(record: DraftSnapshotRecord): Promise<FolderWriteResult> {
  const envelope = { format: "pdf-ai-tools-draft", version: 1, record };
  const json = JSON.stringify(envelope);
  if (new TextEncoder().encode(json).byteLength > MAX_DRAFT_FILE_BYTES) return "failed";
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  return writeBlobToConnectedFolder(workspaceDraftFilename(record.id), blob, true, false);
}

export async function readWorkspaceDraftFilesFromFolder(): Promise<File[]> {
  const handle = await loadHandle();
  if (!handle) throw new Error("folder_not_connected");
  const permission = await handle.queryPermission({ mode: "readwrite" });
  if (permission !== "granted") throw new Error("folder_permission_required");
  const files: File[] = [];
  for await (const [name, entry] of handle.entries()) {
    if (!name.startsWith(DRAFT_PREFIX) || !name.endsWith(DRAFT_SUFFIX) || !("getFile" in entry)) continue;
    const file = await entry.getFile();
    if (file.size <= MAX_DRAFT_FILE_BYTES) files.push(file);
    if (files.length >= 40) break;
  }
  return files;
}

export async function deleteWorkspaceDraftSnapshot(id: string): Promise<void> {
  const handle = await loadHandle();
  if (!handle) return;
  try {
    if (await handle.queryPermission({ mode: "readwrite" }) !== "granted") return;
    await handle.removeEntry(workspaceDraftFilename(id));
  } catch { /* Keep folder content safe if permission is unavailable or the file is absent. */ }
}

function browserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = safeFilename(filename);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Prefer the connected folder; otherwise use the browser/device's normal download flow. */
export async function saveBlobToDeviceOrDownload(blob: Blob, filename: string): Promise<"folder" | "download"> {
  const result = await writeBlobToConnectedFolder(filename, blob, false);
  if (result === "saved") return "folder";
  if ((result === "permission-needed" || result === "failed") && typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("pdat:folder-save-fallback", { detail: { filename, reason: result } }));
  }
  browserDownload(blob, filename);
  return "download";
}

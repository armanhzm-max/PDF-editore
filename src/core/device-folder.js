const HANDLE_DB = "pdf-ai-tools-device-folder";
const HANDLE_DB_VERSION = 1;
const HANDLE_STORE = "settings";
const HANDLE_KEY = "workspace-directory";
const DRAFT_PREFIX = "pdf-ai-tools-draft-";
const DRAFT_SUFFIX = ".pdat.json";
const MAX_DRAFT_FILE_BYTES = 4 * 1024 * 1024 + 32 * 1024;
let cachedHandle = null;
function pickerWindow() { return window; }
export function supportsPersistentFolderAccess() {
    return typeof window !== "undefined" && window.isSecureContext === true && typeof pickerWindow().showDirectoryPicker === "function" && typeof indexedDB !== "undefined";
}
function openHandleDb() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined")
            return reject(new Error("folder_handle_storage_unavailable"));
        const request = indexedDB.open(HANDLE_DB, HANDLE_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(HANDLE_STORE))
                db.createObjectStore(HANDLE_STORE, { keyPath: "key" });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("folder_handle_storage_failed"));
        request.onblocked = () => reject(new Error("folder_handle_storage_blocked"));
    });
}
async function storeHandle(handle) {
    const db = await openHandleDb();
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(HANDLE_STORE, "readwrite");
            tx.objectStore(HANDLE_STORE).put({ key: HANDLE_KEY, handle });
            tx.oncomplete = () => { cachedHandle = handle; resolve(); };
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error("folder_handle_storage_failed"));
        });
    }
    finally {
        db.close();
    }
}
async function loadHandle() {
    if (cachedHandle)
        return cachedHandle;
    try {
        const db = await openHandleDb();
        try {
            return await new Promise((resolve, reject) => {
                const request = db.transaction(HANDLE_STORE, "readonly").objectStore(HANDLE_STORE).get(HANDLE_KEY);
                request.onsuccess = () => {
                    cachedHandle = request.result?.handle ?? null;
                    resolve(cachedHandle);
                };
                request.onerror = () => reject(request.error);
            });
        }
        finally {
            db.close();
        }
    }
    catch {
        return null;
    }
}
function mapPermission(value) {
    return value === "granted" || value === "prompt" || value === "denied" ? value : "unknown";
}
export async function getDeviceFolderStatus() {
    const supported = supportsPersistentFolderAccess();
    if (!supported)
        return { supported: false, connected: false, name: null, permission: "unknown" };
    const handle = await loadHandle();
    if (!handle)
        return { supported: true, connected: false, name: null, permission: "unknown" };
    let permission = "unknown";
    try {
        permission = mapPermission(await handle.queryPermission({ mode: "readwrite" }));
    }
    catch {
        permission = "unknown";
    }
    return { supported: true, connected: true, name: handle.name || null, permission };
}
export async function connectDeviceFolder() {
    if (!supportsPersistentFolderAccess())
        throw new Error("folder_access_unsupported");
    const picker = pickerWindow().showDirectoryPicker;
    if (!picker)
        throw new Error("folder_access_unsupported");
    // This must be called directly from a user-initiated click handler.
    const handle = await picker.call(window, { id: "pdf-ai-tools-workspace", mode: "readwrite" });
    let permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted")
        permission = await handle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted")
        throw new Error("folder_permission_denied");
    await storeHandle(handle);
    return { supported: true, connected: true, name: handle.name || null, permission: "granted" };
}
/** Call this only from a button click; browsers may require fresh user activation. */
export async function requestDeviceFolderPermission() {
    // getDeviceFolderStatus preloads the handle when My Workspace renders. Reuse
    // this in-memory handle so the browser permission request happens immediately
    // inside the user's click activation, without waiting for IndexedDB first.
    const handle = cachedHandle ?? await loadHandle();
    if (!handle)
        throw new Error("folder_not_connected");
    const permission = await handle.requestPermission({ mode: "readwrite" });
    if (permission !== "granted")
        throw new Error("folder_permission_denied");
    return { supported: true, connected: true, name: handle.name || null, permission: "granted" };
}
export async function disconnectDeviceFolder() {
    const db = await openHandleDb();
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(HANDLE_STORE, "readwrite");
            tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error("folder_handle_storage_failed"));
        });
    }
    finally {
        db.close();
    }
    cachedHandle = null;
    // Existing files in the user's folder are intentionally never deleted here.
}
function safeFilename(value) {
    const leaf = value.split(/[\\/]/).pop() ?? "file";
    const safe = leaf.replace(/[<>:"|?*\u0000-\u001f]/g, "-").replace(/[. ]+$/g, "").trim();
    return (safe || "file").slice(0, 160);
}
async function uniqueFileName(handle, requested) {
    const safe = safeFilename(requested);
    try {
        await handle.getFileHandle(safe);
    }
    catch (error) {
        if (error?.name === "NotFoundError")
            return safe;
        throw error;
    }
    const dot = safe.lastIndexOf(".");
    const base = dot > 0 ? safe.slice(0, dot) : safe;
    const ext = dot > 0 ? safe.slice(dot) : "";
    for (let index = 2; index <= 999; index += 1) {
        const candidate = `${base} (${index})${ext}`;
        try {
            await handle.getFileHandle(candidate);
        }
        catch (error) {
            if (error?.name === "NotFoundError")
                return candidate;
            throw error;
        }
    }
    throw new Error("folder_filename_conflict");
}
export async function writeBlobToConnectedFolder(filename, blob, overwrite = false, notify = true) {
    if (!supportsPersistentFolderAccess())
        return "unsupported";
    const handle = await loadHandle();
    if (!handle)
        return "not-connected";
    let permission;
    try {
        permission = await handle.queryPermission({ mode: "readwrite" });
    }
    catch {
        return "permission-needed";
    }
    if (permission !== "granted")
        return "permission-needed";
    try {
        const safeName = overwrite ? safeFilename(filename) : await uniqueFileName(handle, filename);
        const fileHandle = await handle.getFileHandle(safeName, { create: true });
        const writable = await fileHandle.createWritable();
        try {
            await writable.write(blob);
            await writable.close();
        }
        catch (error) {
            try {
                await writable.abort?.();
            }
            catch { /* best effort */ }
            throw error;
        }
        if (notify && typeof window !== "undefined")
            window.dispatchEvent(new CustomEvent("pdat:folder-saved", { detail: { filename: safeName } }));
        return "saved";
    }
    catch {
        return "failed";
    }
}
export function workspaceDraftFilename(id) {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) || "draft";
    return `${DRAFT_PREFIX}${safeId}${DRAFT_SUFFIX}`;
}
export async function writeWorkspaceDraftSnapshot(record) {
    const envelope = { format: "pdf-ai-tools-draft", version: 1, record };
    const json = JSON.stringify(envelope);
    if (new TextEncoder().encode(json).byteLength > MAX_DRAFT_FILE_BYTES)
        return "failed";
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    return writeBlobToConnectedFolder(workspaceDraftFilename(record.id), blob, true, false);
}
export async function readWorkspaceDraftFilesFromFolder() {
    const handle = await loadHandle();
    if (!handle)
        throw new Error("folder_not_connected");
    const permission = await handle.queryPermission({ mode: "readwrite" });
    if (permission !== "granted")
        throw new Error("folder_permission_required");
    const files = [];
    for await (const [name, entry] of handle.entries()) {
        if (!name.startsWith(DRAFT_PREFIX) || !name.endsWith(DRAFT_SUFFIX) || !("getFile" in entry))
            continue;
        const file = await entry.getFile();
        if (file.size <= MAX_DRAFT_FILE_BYTES)
            files.push(file);
        if (files.length >= 40)
            break;
    }
    return files;
}
export async function deleteWorkspaceDraftSnapshot(id) {
    const handle = await loadHandle();
    if (!handle)
        return;
    try {
        if (await handle.queryPermission({ mode: "readwrite" }) !== "granted")
            return;
        await handle.removeEntry(workspaceDraftFilename(id));
    }
    catch { /* Keep folder content safe if permission is unavailable or the file is absent. */ }
}
function browserDownload(blob, filename) {
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
export async function saveBlobToDeviceOrDownload(blob, filename) {
    const result = await writeBlobToConnectedFolder(filename, blob, false);
    if (result === "saved")
        return "folder";
    if ((result === "permission-needed" || result === "failed") && typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("pdat:folder-save-fallback", { detail: { filename, reason: result } }));
    }
    browserDownload(blob, filename);
    return "download";
}

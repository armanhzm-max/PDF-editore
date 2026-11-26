import { saveBlobToDeviceOrDownload } from "./device-folder";
// File access is local-only: no source file is uploaded by these helpers.
const EXTENSIONS_BY_MIME = {
    "application/pdf": [".pdf"],
    "image/png": [".png"],
    "image/jpeg": [".jpg", ".jpeg"],
    "image/webp": [".webp"],
};
export const hasFolderAccess = () => "showDirectoryPicker" in window;
function normalizeFileType(file) {
    if (file.type && file.type !== "application/octet-stream")
        return file;
    const extension = file.name.toLowerCase().split(".").pop() ?? "";
    const mime = Object.entries(EXTENSIONS_BY_MIME).find(([, extensions]) => extensions.includes(`.${extension}`))?.[0];
    return mime ? new File([file], file.name, { type: mime, lastModified: file.lastModified }) : file;
}
export async function pickFiles(accept, multiple) {
    if ("showOpenFilePicker" in window) {
        try {
            const types = accept.map((mime) => ({
                description: mime,
                accept: { [mime]: EXTENSIONS_BY_MIME[mime] ?? [] },
            }));
            const handles = await window.showOpenFilePicker({ multiple, types });
            const picked = await Promise.all(handles.map((h) => h.getFile()));
            return picked.map(normalizeFileType);
        }
        catch (error) {
            // User cancellation is not an error; other picker errors can use the input fallback.
            if (error?.name === "AbortError")
                return [];
            if (error?.name !== "NotAllowedError")
                throw error;
        }
    }
    return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.multiple = multiple;
        input.accept = accept.join(",");
        let finished = false;
        const finish = (files) => {
            if (finished)
                return;
            finished = true;
            window.removeEventListener("focus", onWindowFocus);
            input.remove();
            resolve(files);
        };
        const onWindowFocus = () => window.setTimeout(() => finish(Array.from(input.files ?? []).map(normalizeFileType)), 400);
        input.addEventListener("change", () => finish(Array.from(input.files ?? []).map(normalizeFileType)), { once: true });
        input.addEventListener("cancel", () => finish([]), { once: true });
        window.addEventListener("focus", onWindowFocus, { once: true });
        input.click();
    });
}
// Select a directory (Chromium desktop only) and return matching files.
export async function pickFolder(accept) {
    if (!hasFolderAccess())
        throw new Error("no_folder");
    const dir = await window.showDirectoryPicker({ mode: "readwrite" });
    const files = [];
    for await (const entry of dir.values()) {
        if (entry.kind === "file") {
            const f = normalizeFileType(await entry.getFile());
            if (accept.includes(f.type))
                files.push(f);
        }
    }
    return { dir, files };
}
export async function saveToFolder(dir, file) {
    const h = await dir.getFileHandle(file.name, { create: true });
    const w = await h.createWritable();
    await w.write(file);
    await w.close();
}
export function download(file) {
    void saveBlobToDeviceOrDownload(file, file.name);
}
import { zipSync } from "fflate";
export async function downloadAll(files) {
    if (files.length > 200 || files.reduce((total, file) => total + file.size, 0) > 200 * 1024 * 1024)
        throw new Error("output_limit");
    if (files.length <= 1)
        return files.forEach(download);
    const data = {};
    const used = new Set();
    for (const file of files) {
        const dot = file.name.lastIndexOf(".");
        const base = dot > 0 ? file.name.slice(0, dot) : file.name;
        const ext = dot > 0 ? file.name.slice(dot) : "";
        let name = file.name;
        for (let suffix = 2; used.has(name); suffix++)
            name = `${base}-${suffix}${ext}`;
        used.add(name);
        data[name] = new Uint8Array(await file.arrayBuffer());
    }
    download(new File([zipSync(data)], "results.zip", { type: "application/zip" }));
}

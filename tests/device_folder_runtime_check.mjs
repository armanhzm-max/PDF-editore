import assert from "node:assert/strict";

const dbs = new Map();
class StoreNames {
  constructor(db) { this.db = db; }
  contains(name) { return this.db.stores.has(name); }
}
class MemoryDB {
  constructor(name) { this.name = name; this.stores = new Map(); this.objectStoreNames = new StoreNames(this); }
  createObjectStore(name) { const data = new Map(); this.stores.set(name, data); return { createIndex() {} }; }
  transaction(name) {
    const data = this.stores.get(name);
    const tx = { error: null, oncomplete: null, onerror: null, onabort: null };
    tx.objectStore = () => ({
      put: (value) => { data.set(value.key, value); setTimeout(() => tx.oncomplete?.(), 0); },
      get: (key) => { const req = {}; setTimeout(() => { req.result = data.get(key); req.onsuccess?.(); }, 0); return req; },
      delete: (key) => { data.delete(key); setTimeout(() => tx.oncomplete?.(), 0); },
    });
    tx.abort = () => tx.onabort?.();
    return tx;
  }
  close() {}
}
globalThis.indexedDB = {
  open(name) {
    const request = {};
    setTimeout(() => {
      let db = dbs.get(name);
      if (!db) {
        db = new MemoryDB(name);
        dbs.set(name, db);
        request.result = db;
        request.onupgradeneeded?.();
      } else request.result = db;
      request.onsuccess?.();
    }, 0);
    return request;
  },
};

const disk = new Map();
let permission = "granted";
const dispatched = [];
const notFound = () => Object.assign(new Error("missing"), { name: "NotFoundError" });
const directory = {
  name: "Chosen Documents",
  async queryPermission() { return permission; },
  async requestPermission() { permission = "granted"; return permission; },
  async getFileHandle(name, options = {}) {
    if (!disk.has(name) && !options.create) throw notFound();
    if (!disk.has(name)) disk.set(name, new Blob([]));
    return {
      async getFile() { return new File([disk.get(name)], name); },
      async createWritable() {
        let pending = disk.get(name);
        return {
          async write(value) { pending = value instanceof Blob ? value : new Blob([value]); },
          async close() { disk.set(name, pending); },
          async abort() {},
        };
      },
    };
  },
  async removeEntry(name) { if (!disk.delete(name)) throw notFound(); },
  async *entries() {
    for (const [name, blob] of disk) {
      yield [name, { async getFile() { return new File([blob], name); } }];
    }
  },
};
globalThis.window = {
  isSecureContext: true,
  async showDirectoryPicker() { return directory; },
  dispatchEvent(event) { dispatched.push(event); return true; },
  setTimeout,
};
globalThis.CustomEvent = class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };

const folder = await import("../src/core/device-folder.js");
assert.equal(folder.supportsPersistentFolderAccess(), true);
const connected = await folder.connectDeviceFolder();
assert.equal(connected.connected, true);
assert.equal(connected.name, "Chosen Documents");
assert.equal((await folder.getDeviceFolderStatus()).permission, "granted");

assert.equal(await folder.writeBlobToConnectedFolder("final.pdf", new Blob(["PDF"])), "saved");
assert.equal(await folder.saveBlobToDeviceOrDownload(new Blob(["generated document"]), "report.docx"), "folder");
assert.ok(dispatched.some((event) => event.type === "pdat:folder-saved" && event.detail.filename === "report.docx"));
assert.equal(await folder.writeBlobToConnectedFolder("final.pdf", new Blob(["PDF2"])), "saved");
assert.equal(disk.has("final (2).pdf"), true, "ordinary exports must not overwrite existing files");

const snapshot = {
  id: "draft-007", kind: "word", name: "گزارش فارسی", preview: "متن محلی",
  createdAt: Date.now(), updatedAt: Date.now(), bytes: 25,
  payloadJson: JSON.stringify({ html: "<p>سلام</p>" }),
};
assert.equal(await folder.writeWorkspaceDraftSnapshot(snapshot), "saved");
const files = await folder.readWorkspaceDraftFilesFromFolder();
assert.equal(files.length, 1);
const parsed = JSON.parse(await files[0].text());
assert.equal(parsed.format, "pdf-ai-tools-draft");
assert.equal(parsed.record.name, "گزارش فارسی");

permission = "prompt";
assert.equal(await folder.writeBlobToConnectedFolder("denied.txt", new Blob(["x"])), "permission-needed");
await folder.requestDeviceFolderPermission();
assert.equal((await folder.getDeviceFolderStatus()).permission, "granted");
await folder.deleteWorkspaceDraftSnapshot("draft-007");
assert.equal(disk.has("pdf-ai-tools-draft-draft-007.pdat.json"), false);
await folder.disconnectDeviceFolder();
assert.equal((await folder.getDeviceFolderStatus()).connected, false);
assert.equal(disk.has("final.pdf"), true, "disconnect must not delete user files");
console.log("PASS: folder picker permission, IndexedDB handle persistence, direct writes, unique output names, draft snapshots, generated-file delivery notification, restore listing and safe disconnect");

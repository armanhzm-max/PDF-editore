import assert from "node:assert/strict";

const data = new Map();
globalThis.localStorage = {
  getItem: (key) => data.has(key) ? data.get(key) : null,
  setItem: (key, value) => { data.set(key, String(value)); },
  removeItem: (key) => data.delete(key),
  clear: () => data.clear(),
};
// Exercise the documented localStorage fallback without requiring a browser's IndexedDB.
Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });

const workspace = await import("../src/core/local-workspace.js");
const id = workspace.createWorkspaceId();
const saved = await workspace.saveWorkspaceItem("word", "Persian report", {
  title: "Persian report",
  html: "<h1>گزارش آزمایشی</h1><p>متن محلی</p>",
}, id);
assert.equal(saved.id, id);
assert.equal(saved.kind, "word");

const items = await workspace.listWorkspaceItems();
assert.equal(items.length, 1);
assert.equal(items[0].name, "Persian report");

const loaded = await workspace.loadWorkspaceItem(id);
assert.equal(loaded.payload.title, "Persian report");
assert.match(loaded.payload.html, /گزارش آزمایشی/);

const backup = await workspace.exportWorkspaceBackup();
assert.equal(backup.type, "application/json;charset=utf-8");
const backupFile = new File([backup], "workspace-backup.json", { type: backup.type });
await workspace.deleteWorkspaceItem(id);
assert.equal((await workspace.listWorkspaceItems()).length, 0);

const restored = await workspace.importWorkspaceBackup(backupFile);
assert.equal(restored, 1);
assert.equal((await workspace.listWorkspaceItems()).length, 1);

const removed = await workspace.clearWorkspaceItems();
assert.equal(removed, 1);
assert.equal((await workspace.listWorkspaceItems()).length, 0);

await assert.rejects(
  () => workspace.saveWorkspaceItem("word", "oversized", { html: "x".repeat(4 * 1024 * 1024 + 1) }),
  /workspace_plan_limit/,
);
console.log("PASS: local fallback save/list/load, Persian text persistence, JSON backup export/import, delete, clear-all and plan-aware quota guard");

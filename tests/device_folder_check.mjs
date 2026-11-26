import assert from "node:assert/strict";
const folder = await import("../src/core/device-folder.js");

assert.equal(folder.supportsPersistentFolderAccess(), false, "Node/no-browser should not claim folder picker support");
assert.deepEqual(await folder.getDeviceFolderStatus(), {
  supported: false,
  connected: false,
  name: null,
  permission: "unknown",
});
assert.equal(await folder.writeBlobToConnectedFolder("test.txt", new Blob(["local"])), "unsupported");
assert.equal(folder.workspaceDraftFilename("draft-123"), "pdf-ai-tools-draft-draft-123.pdat.json");
assert.equal(folder.workspaceDraftFilename("../bad/name:*?"), "pdf-ai-tools-draft-___bad_name___.pdat.json");
const snapshot = {
  id: "draft-123", kind: "word", name: "گزارش فارسی", preview: "متن نمونه",
  createdAt: Date.now(), updatedAt: Date.now(), bytes: 9,
  payloadJson: JSON.stringify({ html: "<p>سلام</p>" }),
};
assert.equal(await folder.writeWorkspaceDraftSnapshot(snapshot), "unsupported");
console.log("PASS: unsupported-browser fallback, folder permission status, safe draft paths and no remote fallback");

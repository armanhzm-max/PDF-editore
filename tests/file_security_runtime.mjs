import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch { ts = await import('file:///opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js').then((module) => module.default ?? module); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function loadTs(relative) {
  const source = await fs.readFile(path.join(root, relative), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
}
const signatures = await loadTs('src/core/file-signatures.ts');
const bytes = (values) => new Uint8Array(values);
function fakeFile(name, type, content) {
  const blob = new Blob([content]);
  return { name, type, slice: (...args) => blob.slice(...args) };
}
assert.equal(signatures.resolveAcceptedMime(fakeFile('sample.pdf', 'application/pdf', '%PDF-'), ['application/pdf']), 'application/pdf');
assert.equal(signatures.resolveAcceptedMime(fakeFile('sample.jpg', 'application/pdf', '%PDF-'), ['application/pdf']), null, 'mismatched extension is rejected');
assert.equal(signatures.resolveAcceptedMime(fakeFile('sample.pdf', 'image/png', 'not image'), ['application/pdf']), null, 'mismatched declared MIME is rejected');
assert.equal(signatures.resolveAcceptedMime(fakeFile('sample.pdf', 'application/octet-stream', '%PDF-'), ['application/pdf']), 'application/pdf');
assert.equal(await signatures.hasExpectedFileSignature(fakeFile('sample.pdf', 'application/pdf', '%PDF-1.7'), 'application/pdf'), true);
assert.equal(await signatures.hasExpectedFileSignature(fakeFile('fake.pdf', 'application/pdf', '<html>'), 'application/pdf'), false, 'fake PDF extension is rejected');
assert.equal(await signatures.hasExpectedFileSignature(fakeFile('tiny.png', 'image/png', bytes([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0])), 'image/png'), true);
assert.equal(await signatures.hasExpectedFileSignature(fakeFile('fake.jpg', 'image/jpeg', '<svg onload=alert(1)>'), 'image/jpeg'), false, 'image markup cannot masquerade as an image upload');

const zip = await loadTs('src/core/zip-safety.ts');
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  let centralSize = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const data = new TextEncoder().encode(entry.text ?? 'fixture');
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true); lv.setUint16(8, 0, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true);
    local.set(name, 30); local.set(data, 30 + name.length);
    localParts.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint32(42, offset, true); central.set(name, 46);
    centralParts.push(central); centralSize += central.length; offset += local.length;
  }
  const centralOffset = offset;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, centralOffset, true);
  const all = [...localParts, ...centralParts, eocd];
  const size = all.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size); let cursor = 0;
  for (const part of all) { output.set(part, cursor); cursor += part.length; }
  return output;
}
const good = buildZip([{ name: '[Content_Types].xml', text: 'content' }, { name: 'word/document.xml', text: 'سلام' }]);
assert.equal(zip.inspectZipArchive(good, 1024), new TextEncoder().encode('content').length + new TextEncoder().encode('سلام').length);
assert.throws(() => zip.inspectZipArchive(buildZip([{ name: '../outside.xml' }]), 1024), /zip_invalid/);
assert.throws(() => zip.inspectZipArchive(buildZip([{ name: 'same.xml' }, { name: 'same.xml' }]), 1024), /zip_invalid/);
assert.throws(() => zip.inspectZipArchive(buildZip([{ name: 'big.xml', text: '0123456789' }]), 5), /zip_too_large/);
assert.throws(() => zip.inspectZipArchive(buildZip([{ name: 'one' }, { name: 'two' }, { name: 'three' }]), 1024, undefined, 2), /zip_too_many_entries/);
const badLocalMethod = good.slice(); new DataView(badLocalMethod.buffer).setUint16(8, 8, true);
assert.throws(() => zip.inspectZipArchive(badLocalMethod, 1024), /zip_invalid/);
const corrupt = good.slice(); corrupt[0] = 0;
assert.throws(() => zip.inspectZipArchive(corrupt, 1024), /zip_invalid/);
console.log('PASS: MIME/signature validation and ZIP structure, path, entry-count, size and header-consistency guards');

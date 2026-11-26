import assert from "node:assert/strict";
import { buildRecognizedTranscript } from "../src/core/workflow.js";

const persianPages = [
  { ocrText: `متن اصلاح‌شده
خط دوم` },
  { ocrText: undefined },
  { ocrText: `English paragraph
second line` },
];
const persian = buildRecognizedTranscript(persianPages, "fa");
assert.equal(
  persian,
  `--- صفحه 1 ---
متن اصلاح‌شده
خط دوم

--- صفحه 3 ---
English paragraph
second line`,
);
assert.ok(!persian.includes("صفحه 2"), "unprocessed pages must not be represented as empty OCR output");
assert.equal(
  buildRecognizedTranscript([{ ocrText: "edited text" }], "en"),
  `--- Page 1 ---
edited text`,
);
assert.equal(buildRecognizedTranscript([{ ocrText: "  exact  " }], "en"), `--- Page 1 ---
  exact  `);
assert.equal(buildRecognizedTranscript([{ ocrText: "" }], "en"), `--- Page 1 ---
`);
console.log("PASS: OCR handoff preserves corrected text, RTL content, line breaks and original page indexes; partial scans are supported");

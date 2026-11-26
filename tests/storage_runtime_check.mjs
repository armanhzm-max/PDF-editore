import assert from "node:assert/strict";
import { getInitialLang } from "../src/core/i18n.js";
import { getToken, setToken } from "../src/core/permissions.js";

const defaultLanguage = typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("fa") ? "fa" : "en";
const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

try {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw new Error("Storage access denied"); },
  });
  assert.equal(getInitialLang(), defaultLanguage, "language must fall back when localStorage access throws");
  assert.equal(getToken(), null, "token reads must fail closed when localStorage access throws");
  assert.throws(() => setToken("session-token"), { message: "session_storage_unavailable" }, "login must report a persistence failure");
  assert.doesNotThrow(() => setToken(null), "logout must remain safe when storage is unavailable");

  const values = new Map([["lang", "unsupported"], ["session_token", "saved-token"]]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem(key) { return values.get(key) ?? null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); },
    },
  });
  assert.equal(getInitialLang(), defaultLanguage, "unsupported language values must be ignored");
  values.set("lang", "fa");
  assert.equal(getInitialLang(), "fa", "supported stored language must be restored");
  assert.equal(getToken(), "saved-token", "stored session token must be read");
  setToken("next-token");
  assert.equal(getToken(), "next-token", "new session token must be stored");
  setToken(null);
  assert.equal(getToken(), null, "logout must remove the stored session");
  console.log("PASS: language and session storage runtime handles blocked storage, invalid preferences, token persistence errors and safe logout");
} finally {
  if (originalDescriptor) Object.defineProperty(globalThis, "localStorage", originalDescriptor);
  else delete globalThis.localStorage;
}

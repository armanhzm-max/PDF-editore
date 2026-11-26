import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch { ts = await import('file:///opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js').then((module) => module.default ?? module); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = await fs.readFile(path.join(root, 'worker/index.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  fileName: 'worker/index.ts',
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const errors = (compiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
assert.equal(errors.length, 0, errors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'));
const runtimePath = path.join(root, 'worker/.security-worker-runtime-test.mjs');
const runtimeSource = compiled.outputText
  .replace('from "../shared/translation-limits"', 'from "../shared/translation-limits.js"')
  .replace('from "../shared/agent-tool-catalog"', 'from "../shared/agent-tool-catalog.js"');
await fs.writeFile(runtimePath, runtimeSource, 'utf8');

const secret = 'security-runtime-test-secret-with-at-least-32-characters';
const users = new Map([
  ['user-a', { id: 'user-a', email: 'a@example.invalid', plan_until: 0, stripe_customer: null, stripe_subscription: null, stripe_plan_until: 0, zarinpal_plan_until: 0 }],
  ['user-b', { id: 'user-b', email: 'b@example.invalid', plan_until: 0, stripe_customer: null, stripe_subscription: null, stripe_plan_until: 0, zarinpal_plan_until: 0 }],
]);
class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql.toLowerCase(); this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() {
    if (this.sql.includes('select 1 as revoked from revoked_tokens')) {
      const row = this.db.revoked.get(this.args[0]);
      return row && row.expires_at > this.args[1] ? { revoked: 1 } : null;
    }
    if (this.sql.includes('from users where id = ?')) return this.db.users.get(this.args[0]) ?? null;
    if (this.sql.includes('from users where email = ?')) return [...this.db.users.values()].find((user) => user.email === this.args[0]) ?? null;
    if (this.sql.includes('delete from auth_challenges') && this.sql.includes('returning email_hash')) {
      const [emailHash, codeHash, timestamp] = this.args;
      const row = this.db.challenges.get(emailHash);
      if (!row || row.code_hash !== codeHash || row.expires_at <= timestamp) return null;
      this.db.challenges.delete(emailHash);
      return { email_hash: emailHash };
    }
    if (this.sql.includes('insert into security_rate_limits')) {
      const [bucket, windowStart, expiresAt, max] = this.args;
      const existing = this.db.rateLimits.get(bucket);
      if (!existing || existing.windowStart !== windowStart) {
        this.db.rateLimits.set(bucket, { windowStart, count: 1, expiresAt });
        return { count: 1 };
      }
      if (existing.count >= max) return null;
      existing.count += 1;
      existing.expiresAt = expiresAt;
      return { count: existing.count };
    }
    if (this.sql.includes('from usage_counters')) return null;
    return null;
  }
  async run() {
    if (this.sql.startsWith('insert or replace into revoked_tokens')) {
      this.db.revoked.set(this.args[0], { user_id: this.args[1], expires_at: this.args[2], revoked_at: this.args[3] });
    }
    if (this.sql.startsWith('insert or replace into auth_challenges')) {
      this.db.challenges.set(this.args[0], { code_hash: this.args[1], expires_at: this.args[2] });
    }
    if (this.sql.startsWith('delete from auth_challenges')) {
      const [emailHash, codeHash] = this.args;
      const row = this.db.challenges.get(emailHash);
      if (row?.code_hash === codeHash) this.db.challenges.delete(emailHash);
    }
    if (this.sql.startsWith('insert into users')) {
      const [id, email, created_at] = this.args;
      if (![...this.db.users.values()].some((user) => user.email === email)) {
        this.db.users.set(id, { id, email, plan_until: 0, stripe_customer: null, stripe_subscription: null, stripe_plan_until: 0, zarinpal_plan_until: 0 });
      }
    }
    return { success: true, meta: { changes: 1 } };
  }
  async all() { return { results: [] }; }
}
class FakeDB {
  constructor() { this.users = users; this.revoked = new Map(); this.challenges = new Map(); this.rateLimits = new Map(); }
  prepare(sql) { return new FakeStatement(this, sql); }
}
class FakeKV {
  async get() { return null; }
  async put() { return; }
  async delete() { return; }
}
async function makeToken(uid, exp = Math.floor(Date.now() / 1000) + 3600) {
  const body = Buffer.from(JSON.stringify({ uid, exp })).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${body}.${sig}`;
}
const DB = new FakeDB();
const env = {
  DB, KV: new FakeKV(), JWT_SECRET: secret, APP_URL: 'https://app.example.invalid',
  RESEND_API_KEY: '', MAIL_FROM: '', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '',
  STRIPE_PRICE_ID: '', ZARINPAL_MERCHANT_ID: '', ZARINPAL_AMOUNT_IRR: '',
  AI_ENABLED: 'false', AGENT_ENABLED: 'false', TRANSLATION_ENABLED: 'false',
};
const originalFetch = globalThis.fetch;
let externalCalls = 0;
let externalMode = 'unexpected';
let sentMailPayload = null;
let sentMailRedirect = null;
let turnstileCalls = 0;
globalThis.fetch = async (url, init = {}) => {
  externalCalls += 1;
  if (externalMode === 'stripe-untrusted') return Response.json({ url: 'https://evil.invalid/collect' });
  if (externalMode === 'stripe-valid') return Response.json({ url: 'https://checkout.stripe.com/c/pay/test-session' });
  if (externalMode === 'turnstile-fail' && String(url) === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') { turnstileCalls += 1; return Response.json({ success: false }); }
  if (externalMode === 'resend' && String(url) === 'https://api.resend.com/emails') {
    sentMailPayload = JSON.parse(String(init.body));
    sentMailRedirect = init.redirect;
    return Response.json({ id: 'email-test' });
  }
  throw new Error('unexpected_external_request');
};
function request(pathname, method = 'GET', token = null, options = {}) {
  const headers = new Headers(options.headers ?? {});
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.origin) headers.set('Origin', options.origin);
  return new Request(`https://app.example.invalid${pathname}`, {
    method,
    headers,
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
}

try {
  const { default: worker } = await import(`${pathToFileURL(runtimePath).href}?v=${Date.now()}`);
  const tokenA = await makeToken('user-a');
  const tokenB = await makeToken('user-b');

  const unauthenticated = await worker.fetch(request('/api/me'), env);
  assert.equal(unauthenticated.status, 401, 'private account data requires a token');

  const accountA = await worker.fetch(request('/api/me', 'GET', tokenA), env);
  assert.equal(accountA.status, 200);
  assert.equal((await accountA.json()).email, 'a@example.invalid', 'account A receives only account A profile');
  const accountB = await worker.fetch(request('/api/me', 'GET', tokenB), env);
  assert.equal((await accountB.json()).email, 'b@example.invalid', 'account B receives only account B profile');

  const tampered = `${Buffer.from(JSON.stringify({ uid: 'user-b', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.${tokenA.split('.')[1]}`;
  const tamperedResponse = await worker.fetch(request('/api/me', 'GET', tampered), env);
  assert.equal(tamperedResponse.status, 401, 'changing a signed user ID invalidates the token');

  const wrongMethod = await worker.fetch(request('/api/auth/request', 'GET'), env);
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('Allow'), 'POST');

  const wrongOrigin = await worker.fetch(request('/api/me', 'GET', tokenA, { origin: 'https://attacker.invalid' }), env);
  assert.equal(wrongOrigin.status, 403, 'cross-origin state and private API calls are rejected');
  const allowedOrigin = await worker.fetch(request('/api/me', 'GET', tokenA, { origin: 'https://app.example.invalid' }), env);
  assert.equal(allowedOrigin.status, 200);
  assert.equal(allowedOrigin.headers.get('Access-Control-Allow-Origin'), 'https://app.example.invalid');

  const preflight = await worker.fetch(request('/api/me', 'OPTIONS', null, { origin: 'https://app.example.invalid' }), env);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), 'https://app.example.invalid');
  const forbiddenPreflight = await worker.fetch(request('/api/me', 'OPTIONS', null, { origin: 'https://attacker.invalid' }), env);
  assert.equal(forbiddenPreflight.status, 403);

  const tooLargeBody = await worker.fetch(request('/api/feedback', 'POST', null, {
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'x'.repeat(9_000) }),
  }), env);
  assert.equal(tooLargeBody.status, 413, 'oversized bodies are rejected while streaming');

  const declaredTooLarge = await worker.fetch(request('/api/feedback', 'POST', null, {
    headers: { 'Content-Type': 'application/json', 'Content-Length': '9000' }, body: '{}',
  }), env);
  assert.equal(declaredTooLarge.status, 413, 'declared length is checked before body processing');

  const disabledAI = await worker.fetch(request('/api/ai', 'POST', tokenA, { body: JSON.stringify({ prompt: 'should remain disabled' }) }), env);
  assert.equal(disabledAI.status, 503);
  assert.equal((await disabledAI.json()).error, 'ai_disabled');
  assert.equal(externalCalls, 0, 'AI-disabled routes do not make provider requests');

  const billingEnv = { ...env, STRIPE_SECRET_KEY: 'test-only-secret', STRIPE_PRICE_ID: 'price_test' };
  externalMode = 'stripe-untrusted';
  const badProviderRedirect = await worker.fetch(request('/api/billing/checkout', 'POST', tokenA, {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'stripe' }),
  }), billingEnv);
  assert.equal(badProviderRedirect.status, 502, 'untrusted provider redirect URLs must not be returned');
  externalMode = 'stripe-valid';
  const validProviderRedirect = await worker.fetch(request('/api/billing/checkout', 'POST', tokenA, {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider: 'stripe' }),
  }), billingEnv);
  assert.equal(validProviderRedirect.status, 200);
  assert.equal((await validProviderRedirect.json()).url, 'https://checkout.stripe.com/c/pay/test-session');
  externalMode = 'unexpected';

  const authEnv = { ...env, RESEND_API_KEY: 'test-resend-secret', MAIL_FROM: 'PDF Tools <login@example.invalid>' };
  externalMode = 'resend';
  const authEmail = 'new-user@example.invalid';
  const authRequestResponse = await worker.fetch(request('/api/auth/request', 'POST', null, {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: authEmail }),
  }), authEnv);
  assert.equal(authRequestResponse.status, 200);
  assert.equal(sentMailRedirect, 'error', 'mail API redirects are rejected');
  assert.equal(sentMailPayload.to, authEmail);

  const turnstileEnv = { ...authEnv, TURNSTILE_SECRET: 'test-turnstile-secret' };
  externalMode = 'turnstile-fail';
  const invalidChallengeRequest = () => worker.fetch(request('/api/auth/request', 'POST', null, {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'blocked@example.invalid', turnstile: 'invalid-test' }),
  }), turnstileEnv);
  const invalidChallengeResponses = [];
  for (let index = 0; index < 6; index += 1) invalidChallengeResponses.push(await invalidChallengeRequest());
  assert.equal(invalidChallengeResponses.slice(0, 5).every((response) => response.status === 400), true);
  assert.equal(invalidChallengeResponses[5].status, 429, 'local IP/email limits must block before another Turnstile provider call');
  assert.equal(turnstileCalls, 5, 'the external CAPTCHA provider is not called after local throttling blocks the request');

  externalMode = 'unexpected';
  const otp = sentMailPayload.text.match(/(?:^|\n)(\d{6})(?:\n|$)/)?.[1];
  assert.ok(otp, 'the test mail sink receives a six-digit sign-in code');
  const emailDigest = await (async () => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(authEmail));
    return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
  })();
  const challenge = DB.challenges.get(emailDigest);
  assert.ok(challenge, 'the challenge is persisted using an HMAC email key');
  const codeDigest = await (async () => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${authEmail}:${otp}`));
    return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
  })();
  assert.equal(challenge.code_hash, codeDigest, 'the code is stored as a secret-keyed HMAC, not a brute-forceable plain hash');
  externalMode = 'unexpected';
  const verifyRequest = () => worker.fetch(request('/api/auth/verify', 'POST', null, {
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: authEmail, code: otp }),
  }), authEnv);
  const concurrentVerifications = await Promise.all([verifyRequest(), verifyRequest()]);
  assert.deepEqual(concurrentVerifications.map((response) => response.status).sort(), [200, 401], 'concurrent verification can consume an OTP only once');
  const loginResult = await concurrentVerifications.find((response) => response.status === 200).json();
  const loggedInProfile = await worker.fetch(request('/api/me', 'GET', loginResult.token), authEnv);
  assert.equal(loggedInProfile.status, 200, 'the one-time code produces a valid signed-in session');

  const logout = await worker.fetch(request('/api/auth/logout', 'POST', tokenA, {
    headers: { 'Content-Type': 'application/json' }, body: '{}',
  }), env);
  assert.equal(logout.status, 200);
  const afterLogout = await worker.fetch(request('/api/me', 'GET', tokenA), env);
  assert.equal(afterLogout.status, 401, 'logout revokes the signed token server-side');

  for (const header of ['X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Content-Security-Policy', 'Cache-Control']) {
    assert.ok(accountB.headers.get(header), `${header} must be present on API responses`);
  }
  const badConfig = { ...env, APP_URL: 'https://app.example.invalid/unexpected-path' };
  const rejectedConfig = await worker.fetch(request('/api/features'), badConfig);
  assert.equal(rejectedConfig.status, 503, 'APP_URL must be a trusted origin without a path');
  console.log('PASS: Worker auth/identity isolation, OTP single-use/HMAC, Turnstile pre-throttling, token revocation, CORS, method/body limits, security headers and AI-disabled boundary');
} finally {
  globalThis.fetch = originalFetch;
  await fs.rm(runtimePath, { force: true });
}

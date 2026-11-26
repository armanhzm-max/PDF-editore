import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); } catch { ts = await import('file:///opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js').then((module) => module.default ?? module); }

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const workerSource = await fs.readFile(path.join(root, 'worker/index.ts'), 'utf8');
const compiled = ts.transpileModule(workerSource, {
  fileName: 'worker/index.ts',
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const syntaxErrors = (compiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
assert.equal(syntaxErrors.length, 0, syntaxErrors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'));
const runtimePath = path.join(root, 'worker/.translation-worker-runtime-test.mjs');
const runtimeSource = compiled.outputText.replace(
  'from "../shared/translation-limits"',
  'from "../shared/translation-limits.js"',
).replace(
  'from "../shared/agent-tool-catalog"',
  'from "../shared/agent-tool-catalog.js"',
);
await fs.writeFile(runtimePath, runtimeSource, 'utf8');

const originalFetch = globalThis.fetch;

class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() {
    const sql = this.sql.toLowerCase();
    if (sql.includes('select 1 as revoked from revoked_tokens')) return null;
    if (sql.includes('insert into security_rate_limits')) {
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
    if (sql.includes('from users where id = ?')) return this.db.user;
    if (sql.includes('select count from usage_counters')) return this.db.count > 0 ? { count: this.db.count } : null;
    if (sql.includes('insert into usage_counters')) {
      const max = Number(this.args.at(-1));
      if (this.db.count >= max) return null;
      this.db.count += 1;
      return { count: this.db.count };
    }
    return null;
  }
  async run() {
    if (this.sql.toLowerCase().startsWith('update usage_counters')) {
      this.db.count = Math.max(0, this.db.count - 1);
    }
    return { success: true };
  }
  async all() { return { results: [{ usage_type: 'translate', count: this.db.count }] }; }
}
class FakeDB {
  constructor(user) { this.user = user; this.count = 0; this.rateLimits = new Map(); }
  prepare(sql) { return new FakeStatement(this, sql); }
}
class FakeKV {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key) ?? null; }
  async put(key, value) { this.values.set(key, value); }
}

async function makeToken(uid, secret) {
  const body = Buffer.from(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `${body}.${signature}`;
}

function makeEnv({ plan = 'free', translationEnabled = 'true', aiEnabled = 'false', count = 0, provider = 'anthropic' } = {}) {
  const user = {
    id: `user-${plan}`, email: 'runtime-test@example.invalid',
    plan_until: plan === 'pro' ? Math.floor(Date.now() / 1000) + 86400 : 0,
    stripe_customer: null, stripe_subscription: null, stripe_plan_until: 0, zarinpal_plan_until: 0,
  };
  const DB = new FakeDB(user); DB.count = count;
  return {
    env: {
      DB, KV: new FakeKV(), JWT_SECRET: 'runtime-test-secret-with-more-than-32-characters', APP_URL: 'https://example.invalid',
      AI_API_KEY: 'runtime-provider-key', AI_ENABLED: aiEnabled, TRANSLATION_ENABLED: translationEnabled,
      AI_PROVIDER: provider, AI_API_URL: provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : 'https://provider.example.invalid/v1/chat/completions', AI_MODEL: 'runtime-test-model',
      RESEND_API_KEY: '', MAIL_FROM: 'test@example.invalid', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '',
      STRIPE_PRICE_ID: '', ZARINPAL_MERCHANT_ID: '', ZARINPAL_AMOUNT_IRR: '',
    }, DB, token: awaitToken(user.id, 'runtime-test-secret-with-more-than-32-characters'),
  };
}

async function awaitToken(uid, secret) { return makeToken(uid, secret); }
function request(url, method, token, body) {
  return new Request(`https://app.example.invalid${url}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

try {
  const { default: worker } = await import(`${pathToFileURL(runtimePath).href}?v=${Date.now()}`);

  const unauthorized = await worker.fetch(request('/api/translate', 'GET', null), makeEnv().env);
  assert.equal(unauthorized.status, 401, 'translation usage requires authentication');

  const disabled = makeEnv({ translationEnabled: 'false', aiEnabled: 'false' });
  const disabledUsage = await worker.fetch(request('/api/translate', 'GET', await disabled.token), disabled.env);
  assert.equal(disabledUsage.status, 200);
  assert.equal((await disabledUsage.json()).enabled, false, 'translation remains independently disabled');
  const disabledPost = await worker.fetch(request('/api/translate', 'POST', await disabled.token, { text: 'Hello', sourceLanguage: 'en', targetLanguage: 'fa' }), disabled.env);
  assert.equal(disabledPost.status, 503);
  assert.equal((await disabledPost.json()).error, 'translation_disabled');
  const generalAi = await worker.fetch(request('/api/ai', 'POST', await disabled.token, { prompt: 'test' }), disabled.env);
  assert.equal(generalAi.status, 503);
  assert.equal((await generalAi.json()).error, 'ai_disabled', 'general AI remains disabled');

  let providerMode = 'success';
  let providerRequests = [];
  let providerForMock = 'anthropic';
  globalThis.fetch = async (url, init = {}) => {
    const headers = new Headers(init.headers);
    providerRequests.push({ url: String(url), headers, body: JSON.parse(String(init.body)) });
    if (providerMode === 'failure') return new Response(JSON.stringify({ error: 'provider busy' }), { status: 429 });
    if (providerForMock === 'openai-compatible') {
      const content = providerMode === 'auto' ? '[[SOURCE_LANGUAGE:fa]]\nHello from the test provider' : providerMode === 'truncated' ? 'partial' : 'Hello from the test provider';
      return Response.json({ choices: [{ message: { content }, finish_reason: providerMode === 'truncated' ? 'length' : 'stop' }] });
    }
    if (providerMode === 'auto') return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: '[[SOURCE_LANGUAGE:fa]]\nHello from the test provider' }] });
    if (providerMode === 'truncated') return Response.json({ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }] });
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hello from the test provider' }] });
  };

  const pro = makeEnv({ plan: 'pro' });
  const proToken = await pro.token;
  const proUsageResponse = await worker.fetch(request('/api/translate', 'GET', proToken), pro.env);
  const proUsage = await proUsageResponse.json();
  assert.equal(proUsage.plan, 'pro');
  assert.equal(proUsage.limit, 200);
  assert.equal(proUsage.maxCharacters, 20_000);

  const aiStillDisabled = await worker.fetch(request('/api/ai', 'POST', proToken, { prompt: 'must remain disabled' }), pro.env);
  assert.equal(aiStillDisabled.status, 503);
  assert.equal((await aiStillDisabled.json()).error, 'ai_disabled', 'enabling translation does not enable general AI');

  const invalidLanguage = await worker.fetch(request('/api/translate', 'POST', proToken, { text: 'Hello', sourceLanguage: 'xx', targetLanguage: 'fa' }), pro.env);
  assert.equal(invalidLanguage.status, 400);
  assert.equal(pro.DB.count, 0, 'invalid languages do not consume quota');
  const sameLanguage = await worker.fetch(request('/api/translate', 'POST', proToken, { text: 'Hello', sourceLanguage: 'en', targetLanguage: 'en' }), pro.env);
  assert.equal(sameLanguage.status, 400);
  assert.equal(pro.DB.count, 0, 'same-language requests do not consume quota');

  const successResponse = await worker.fetch(request('/api/translate', 'POST', proToken, {
    text: 'سلام، لطفاً این متن را ترجمه کن.', sourceLanguage: 'fa', targetLanguage: 'en',
  }), pro.env);
  assert.equal(successResponse.status, 200);
  const success = await successResponse.json();
  assert.equal(success.translatedText, 'Hello from the test provider');
  assert.equal(success.used, 1);
  assert.equal(success.remaining, 199);
  assert.equal(providerRequests.at(-1).url, 'https://api.anthropic.com/v1/messages');
  assert.equal(providerRequests.at(-1).headers.get('x-api-key'), 'runtime-provider-key');
  assert.match(providerRequests.at(-1).body.messages[0].content, /سلام، لطفاً این متن را ترجمه کن\./);
  assert.equal(JSON.stringify(providerRequests.at(-1).body).includes('image'), false, 'provider receives text only');

  const free = makeEnv({ plan: 'free' });
  const freeToken = await free.token;
  const tooLong = await worker.fetch(request('/api/translate', 'POST', freeToken, {
    text: 'ا'.repeat(3001), sourceLanguage: 'fa', targetLanguage: 'en',
  }), free.env);
  assert.equal(tooLong.status, 400);
  assert.equal(free.DB.count, 0, 'oversized input does not consume quota');
  for (let index = 0; index < 3; index += 1) {
    const response = await worker.fetch(request('/api/translate', 'POST', freeToken, {
      text: `متن آزمایشی ${index}`, sourceLanguage: 'fa', targetLanguage: 'en',
    }), free.env);
    assert.equal(response.status, 200);
  }
  const freeLimit = await worker.fetch(request('/api/translate', 'POST', freeToken, {
    text: 'یک درخواست اضافه', sourceLanguage: 'fa', targetLanguage: 'en',
  }), free.env);
  assert.equal(freeLimit.status, 429);
  assert.equal((await freeLimit.json()).error, 'translation_limit_reached');
  assert.equal(free.DB.count, 3);

  const failure = makeEnv({ plan: 'pro' });
  providerMode = 'failure';
  const providerFailure = await worker.fetch(request('/api/translate', 'POST', await failure.token, {
    text: 'Try again', sourceLanguage: 'en', targetLanguage: 'fa',
  }), failure.env);
  assert.equal(providerFailure.status, 503);
  assert.equal(failure.DB.count, 0, 'provider failures refund quota');

  const autoDetect = makeEnv({ plan: 'pro' });
  providerMode = 'auto';
  const autoResponse = await worker.fetch(request('/api/translate', 'POST', await autoDetect.token, { text: 'سلام', sourceLanguage: 'auto', targetLanguage: 'en' }), autoDetect.env);
  assert.equal(autoResponse.status, 200);
  const autoResult = await autoResponse.json();
  assert.equal(autoResult.detectedSourceLanguage, 'fa');
  assert.equal(autoResult.translatedText, 'Hello from the test provider');

  const rateLimited = makeEnv({ plan: 'pro' });
  providerMode = 'success';
  for (let index = 0; index < 10; index += 1) {
    const response = await worker.fetch(request('/api/translate', 'POST', await rateLimited.token, { text: `Burst ${index}`, sourceLanguage: 'en', targetLanguage: 'fa' }), rateLimited.env);
    assert.equal(response.status, 200);
  }
  const burstBlocked = await worker.fetch(request('/api/translate', 'POST', await rateLimited.token, { text: 'Burst 11', sourceLanguage: 'en', targetLanguage: 'fa' }), rateLimited.env);
  assert.equal(burstBlocked.status, 429);
  assert.equal((await burstBlocked.json()).error, 'too_many');

  const truncated = makeEnv({ plan: 'pro' });
  providerMode = 'truncated';
  const truncatedResponse = await worker.fetch(request('/api/translate', 'POST', await truncated.token, {
    text: 'A longer document fragment', sourceLanguage: 'en', targetLanguage: 'fa',
  }), truncated.env);
  assert.equal(truncatedResponse.status, 502);
  assert.equal((await truncatedResponse.json()).error, 'translation_response_truncated');
  assert.equal(truncated.DB.count, 0, 'truncated translations refund quota');

  const compatible = makeEnv({ plan: 'pro', provider: 'openai-compatible' });
  providerForMock = 'openai-compatible';
  providerMode = 'success';
  const compatibleResponse = await worker.fetch(request('/api/translate', 'POST', await compatible.token, { text: 'سلام', sourceLanguage: 'fa', targetLanguage: 'en' }), compatible.env);
  assert.equal(compatibleResponse.status, 200);
  assert.equal((await compatibleResponse.json()).translatedText, 'Hello from the test provider');
  assert.equal(providerRequests.at(-1).url, 'https://provider.example.invalid/v1/chat/completions');
  assert.equal(providerRequests.at(-1).headers.get('authorization'), 'Bearer runtime-provider-key');
  assert.equal(providerRequests.at(-1).body.messages[0].role, 'system');

  const compatibleTruncated = makeEnv({ plan: 'pro', provider: 'openai-compatible' });
  providerMode = 'truncated';
  const compatibleTruncatedResponse = await worker.fetch(request('/api/translate', 'POST', await compatibleTruncated.token, { text: 'A longer text', sourceLanguage: 'en', targetLanguage: 'fa' }), compatibleTruncated.env);
  assert.equal(compatibleTruncatedResponse.status, 502);
  assert.equal((await compatibleTruncatedResponse.json()).error, 'translation_response_truncated');
  assert.equal(compatibleTruncated.DB.count, 0, 'compatible provider truncated output refunds quota');
  providerForMock = 'anthropic';
  providerMode = 'success';

  console.log('PASS: Worker runtime authenticates translation requests and keeps general AI disabled');
  console.log('PASS: translation feature flag, Free/Pro limits, Unicode character caps and text-only provider payload work');
  console.log('PASS: auto-detection markers, invalid-language rejection and per-account burst throttling work');
  console.log('PASS: provider failures and truncated output release the reserved daily quota');
  console.log('PASS: Translator uses the provider-independent adapter for Anthropic and OpenAI-compatible providers');
} finally {
  globalThis.fetch = originalFetch;
  await fs.rm(runtimePath, { force: true });
}

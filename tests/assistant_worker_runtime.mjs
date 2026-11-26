import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); }
catch { ts = await import('file:///opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js').then((module) => module.default ?? module); }

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const sharedPath = path.join(root, 'shared/agent-tool-catalog.ts');
const workerSource = await fs.readFile(path.join(root, 'worker/index.ts'), 'utf8');
const workerCompiled = ts.transpileModule(workerSource, {
  fileName: 'worker/index.ts',
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const syntaxErrors = (workerCompiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
assert.equal(syntaxErrors.length, 0, syntaxErrors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'));
const sharedSource = await fs.readFile(sharedPath, 'utf8');
const sharedCompiled = ts.transpileModule(sharedSource, {
  fileName: 'shared/agent-tool-catalog.ts',
  reportDiagnostics: true,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const sharedErrors = (sharedCompiled.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error);
assert.equal(sharedErrors.length, 0, sharedErrors.map((item) => ts.flattenDiagnosticMessageText(item.messageText, '\n')).join('\n'));
const sharedRuntimePath = path.join(root, 'shared/.agent-tool-catalog-runtime-test.mjs');
const workerRuntimePath = path.join(root, 'worker/.assistant-worker-runtime-test.mjs');
const workerRuntimeSource = workerCompiled.outputText
  .replace('from "../shared/translation-limits"', 'from "../shared/translation-limits.js"')
  .replace('from "../shared/agent-tool-catalog"', 'from "../shared/.agent-tool-catalog-runtime-test.mjs"');
await fs.writeFile(sharedRuntimePath, sharedCompiled.outputText, 'utf8');
await fs.writeFile(workerRuntimePath, workerRuntimeSource, 'utf8');

const secret = 'assistant-runtime-secret-with-more-than-32-characters';
const user = {
  id: 'assistant-user', email: 'assistant-runtime@example.invalid', plan_until: 0,
  stripe_customer: null, stripe_subscription: null, stripe_plan_until: 0, zarinpal_plan_until: 0,
};
class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async first() {
    const sql = this.sql.toLowerCase();
    if (sql.includes('select 1 as revoked from revoked_tokens')) return null;
    if (sql.includes('from users where id = ?')) return this.db.user;
    if (sql.includes('select count from usage_counters')) return this.db.counts.get(`${this.args[0]}:${this.args[1]}:${this.args[2]}`) ?? null;
    return null;
  }
  async run() { return { success: true }; }
  async all() { return { results: [] }; }
}
class FakeDB {
  constructor() { this.user = user; this.counts = new Map(); this.calls = []; }
  prepare(sql) { this.calls.push(sql); return new FakeStatement(this, sql); }
}
class FakeKV {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key) ?? null; }
  async put(key, value) { this.values.set(key, value); }
}
async function makeToken(uid = user.id) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)))].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${payload}.${sig}`;
}
function makeEnv({ aiEnabled = 'false', agentEnabled = 'false', providerConfigured = true, provider = 'anthropic' } = {}) {
  const DB = new FakeDB();
  const env = {
    DB, KV: new FakeKV(), JWT_SECRET: secret, APP_URL: 'https://app.example.invalid',
    AI_ENABLED: aiEnabled, AGENT_ENABLED: agentEnabled, AI_PROVIDER: provider,
    AI_SUPPORTED_CAPABILITIES: 'chat,documents,agent,tool-calling',
    ...(providerConfigured ? { AI_API_KEY: 'test-only-secret-never-returned', AI_API_URL: provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : 'https://provider.example.invalid/v1/chat/completions', AI_MODEL: 'test-model' } : {}),
    AI_REQUEST_TIMEOUT_MS: '10000', AI_MAX_OUTPUT_TOKENS: '2048',
    RESEND_API_KEY: '', MAIL_FROM: 'test@example.invalid', STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '',
    STRIPE_PRICE_ID: '', ZARINPAL_MERCHANT_ID: '', ZARINPAL_AMOUNT_IRR: '',
  };
  return { env, DB, KV: env.KV };
}
function request(url, method = 'GET', token = '', body) {
  return new Request(`https://app.example.invalid${url}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const originalFetch = globalThis.fetch;
let outboundRequests = 0;
globalThis.fetch = async () => { outboundRequests += 1; throw new Error('External AI calls are forbidden in this test.'); };
try {
  const { default: worker } = await import(`${pathToFileURL(workerRuntimePath).href}?v=${Date.now()}`);

  const off = makeEnv({ aiEnabled: 'false', agentEnabled: 'false' });
  const featureResponse = await worker.fetch(request('/api/features'), off.env);
  assert.equal(featureResponse.status, 200);
  const featureStatus = await featureResponse.json();
  assert.equal(featureStatus.aiEnabled, false);
  assert.equal(featureStatus.chatEnabled, false);
  assert.equal(featureStatus.documentsEnabled, false);
  assert.equal(featureStatus.agentEnabled, false);
  assert.equal(featureStatus.reason, 'disabled');
  assert.equal(JSON.stringify(featureStatus).includes('test-only-secret'), false);
  for (const endpoint of ['/api/ai', '/api/assistant', '/api/agent']) {
    const response = await worker.fetch(request(endpoint, 'POST', '', { prompt: 'x' }), off.env);
    assert.equal(response.status, 503, `${endpoint} is blocked while AI is disabled`);
    assert.equal((await response.json()).error, 'ai_disabled');
  }
  assert.equal(outboundRequests, 0, 'no provider network call occurs while AI is disabled');
  assert.equal(off.DB.calls.length, 0, 'disabled requests do not touch account quotas');

  const missingProvider = makeEnv({ aiEnabled: 'true', providerConfigured: false });
  const missingStatus = await (await worker.fetch(request('/api/features'), missingProvider.env)).json();
  assert.equal(missingStatus.aiEnabled, false);
  assert.equal(missingStatus.reason, 'not_configured');
  const missingCall = await worker.fetch(request('/api/assistant', 'POST', '', { messages: [{ role: 'user', content: 'hi' }], documentContext: '' }), missingProvider.env);
  assert.equal(missingCall.status, 503);

  const enabledNoAgent = makeEnv({ aiEnabled: 'true', agentEnabled: 'false' });
  const enabledStatus = await (await worker.fetch(request('/api/features'), enabledNoAgent.env)).json();
  assert.equal(enabledStatus.chatEnabled, true);
  assert.equal(enabledStatus.documentsEnabled, true);
  assert.equal(enabledStatus.agentEnabled, false);
  assert.equal(enabledStatus.providerConfigured, true);
  const unauthorizedAssistant = await worker.fetch(request('/api/assistant', 'POST', '', { messages: [{ role: 'user', content: 'hello' }], documentContext: '' }), enabledNoAgent.env);
  assert.equal(unauthorizedAssistant.status, 401);
  assert.equal((await unauthorizedAssistant.json()).error, 'login_required');
  const disabledAgent = await worker.fetch(request('/api/agent', 'POST', '', { messages: [{ role: 'user', content: 'run a tool' }] }), enabledNoAgent.env);
  assert.equal(disabledAgent.status, 503);
  assert.equal((await disabledAgent.json()).error, 'agent_disabled');

  const token = await makeToken();
  const emptyHistory = await worker.fetch(request('/api/assistant', 'POST', token, { messages: [], documentContext: '' }), enabledNoAgent.env);
  assert.equal(emptyHistory.status, 400);
  assert.equal((await emptyHistory.json()).error, 'invalid_input');
  const malformedAI = await worker.fetch(request('/api/ai', 'POST', token, { prompt: 'summarize' }), enabledNoAgent.env);
  assert.equal(malformedAI.status, 400);
  assert.equal((await malformedAI.json()).error, 'invalid_input');
  const invalidTool = await worker.fetch(request('/api/agent', 'POST', token, {
    messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'bad-1', name: 'execute-shell', input: { files: ['report.pdf'], command: 'whoami' } }] }],
    files: [{ name: 'report.pdf', type: 'application/pdf', size: 20 }],
    tools: [{ name: 'execute-shell', input_schema: { type: 'object', properties: { command: { type: 'string' } } } }],
  }), enabledNoAgent.env);
  assert.equal(invalidTool.status, 503); // Agent is off: client schemas never get considered.
  assert.equal((await invalidTool.json()).error, 'agent_disabled');

  const enabledAgent = makeEnv({ aiEnabled: 'true', agentEnabled: 'true' });
  const tokenForAgent = await makeToken();
  const invalidToolWhenEnabled = await worker.fetch(request('/api/agent', 'POST', tokenForAgent, {
    messages: [{ role: 'assistant', content: [{ type: 'tool_use', id: 'bad-2', name: 'execute-shell', input: { files: ['report.pdf'], command: 'whoami' } }] }],
    files: [{ name: 'report.pdf', type: 'application/pdf', size: 20 }],
    tools: [{ name: 'execute-shell', input_schema: { type: 'object', properties: { command: { type: 'string' } } } }],
  }), enabledAgent.env);
  assert.equal(invalidToolWhenEnabled.status, 400);
  assert.equal((await invalidToolWhenEnabled.json()).error, 'invalid_tool_arguments');
  assert.equal(outboundRequests, 0, 'validation and feature-state tests never invoke an external provider');
  assert.equal(enabledAgent.DB.calls.length, 2, 'invalid tool calls perform only the token-revocation and account-lookup reads, with no quota mutation');
  assert.ok(enabledAgent.DB.calls.some((sql) => sql.toLowerCase().includes('revoked_tokens')));
  assert.ok(enabledAgent.DB.calls.some((sql) => sql.toLowerCase().includes('from users where id = ?')));

  console.log('PASS: public feature status is non-sensitive, fail-closed and independently configures chat/documents/agent');
  console.log('PASS: AI, Assistant and Agent endpoints reject disabled or unconfigured features before provider calls');
  console.log('PASS: authentication, request schemas and server-owned tool catalogue are validated before quota reservation');
  console.log('PASS: no external provider request occurs during disabled-state and validation tests');
} finally {
  globalThis.fetch = originalFetch;
  await fs.rm(workerRuntimePath, { force: true });
  await fs.rm(sharedRuntimePath, { force: true });
}

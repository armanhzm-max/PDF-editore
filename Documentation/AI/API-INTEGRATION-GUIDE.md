# AI API Integration Guide — PDF & Image AI Tools

**Status: prepared, intentionally disconnected.** The general AI Assistant, document-analysis endpoint, and agent tool-calling path are implemented as application/Worker contracts. They must remain disabled until the project owner explicitly activates them. No external AI API is called by the current default configuration.

## 1. Architecture

1. The browser reads supported PDF, DOCX, XLSX, PPTX, TXT, CSV, and TSV files locally through `src/core/document-extract.ts`.
2. The selected text is kept in browser memory/local workspace. The original file is not uploaded by the document extraction pipeline.
3. The Assistant UI (`src/ui/Chat.tsx`) prepares the conversation and selected-source context. It does not invent responses while AI is disabled.
4. `src/core/ai.ts` asks the same-origin Worker's public `GET /api/features` endpoint for non-sensitive feature status. It never calls an external AI provider directly.
5. Authenticated requests go to the Worker only:
   - `POST /api/ai`: document analysis, summaries, comparisons, structured extraction, and document-derived presentation outlines.
   - `POST /api/assistant`: ordinary conversation, optionally with explicitly selected extracted document text.
   - `POST /api/agent`: controlled tool-calling loop. The Worker supplies the canonical tool schemas; the browser executes approved local tools.
6. Provider-specific code is isolated inside `worker/index.ts` in `requestAIProvider()`. The frontend does not know the API key, provider endpoint, or provider-specific headers.

### Trust boundaries

- Document content is untrusted evidence, never instructions that can override the system message.
- The model can request only tools in `shared/agent-tool-catalog.ts`.
- The Worker does not accept client-provided tool schemas. It builds the provider's tool list itself and validates the returned tool name, arguments, and file names.
- The browser runs tool implementations from `src/tools/*` only. No arbitrary JavaScript, `eval`, model-supplied code, unrestricted filesystem access, or model-controlled network access is permitted.
- A `Tool` can set `requiresConfirmation: true` to require an explicit browser confirmation immediately before execution. Existing registered tools are non-destructive output-producing operations; no destructive tool is enabled by default.

## 2. Current activation state

The checked-in defaults are intentionally off:

```toml
AI_ENABLED = "false"
AGENT_ENABLED = "false"
TRANSLATION_ENABLED = "false"
```

The current deployment should have no `AI_API_KEY` secret configured until the owner is ready. A missing key also causes the public status to report `not_configured` if an enable flag is accidentally switched on.

`GET /api/features` is public and returns only non-secret booleans and capability names. It does not return credentials, model keys, or private provider configuration.

The Worker remains authoritative. Hiding a button or modifying browser JavaScript cannot make `/api/ai`, `/api/assistant`, or `/api/agent` work while the server flags are disabled.

## 3. Existing API contracts

### `GET /api/features` — public

Response example while disabled:

```json
{
  "aiEnabled": false,
  "chatEnabled": false,
  "documentsEnabled": false,
  "agentEnabled": false,
  "providerConfigured": false,
  "reason": "disabled",
  "capabilities": []
}
```

Possible `reason` values: `disabled`, `not_configured`, `ready`. A network/unavailable response is handled by the frontend as disabled.

### `POST /api/ai` — authenticated, document-analysis quota

Request:

```json
{
  "prompt": "Summarize the selected report and cite its page markers.",
  "text": "[report.pdf · Page 1]\n... locally extracted text ...",
  "messages": [
    { "role": "user", "content": "Please focus on the budget." }
  ]
}
```

`messages` is optional. `prompt` and `text` are required. Limits are checked using the server-derived Free/Pro plan and the `ai` UTC daily counter. The request body, prompt size, context size, and rate are bounded.

Success response:

```json
{ "result": "...", "used": 1, "limit": 3 }
```

### `POST /api/assistant` — authenticated, assistant quota

Request:

```json
{
  "messages": [
    { "role": "user", "content": "What are the main findings?" },
    { "role": "assistant", "content": "..." },
    { "role": "user", "content": "Compare the two dates." }
  ],
  "documentContext": "[a.pdf · Page 2]\n... selected local text ..."
}
```

Only user/assistant text messages are accepted. The selected text is appended as untrusted evidence. The daily counter is the existing `agent` counter (shared with the Agent path) so Assistant and Agent requests cannot bypass the same quota by switching endpoints.

### `POST /api/agent` — authenticated, controlled tools

Request:

```json
{
  "messages": [
    { "role": "user", "content": "Convert report-image.png to webp." }
  ],
  "files": [
    { "name": "report-image.png", "type": "image/png", "size": 24000 }
  ]
}
```

There is deliberately no `tools` property in this contract. The Worker selects the authoritative schemas from `shared/agent-tool-catalog.ts`. Tool calls are validated server-side against that catalogue and the file metadata list, then revalidated in the browser against the actual local workspace, tool options, plan limits, file types, and workspace capacity.

Response is a normalized message block list with `stop_reason`. Only registered `text` and `tool_use` blocks are accepted.

## 4. Provider abstraction

The Worker currently has a small adapter with two formats:

- `AI_PROVIDER="anthropic"` — Messages API format.
- `AI_PROVIDER="openai-compatible"` — Chat Completions-compatible format with function tool-call normalization.

The app-specific API contract does not change when the provider changes. Only the Worker adapter needs a new implementation if another provider is selected. No third-party SDK is required.

Configuration variables:

| Variable | Purpose |
|---|---|
| `AI_PROVIDER` | `anthropic` or `openai-compatible` |
| `AI_API_URL` | HTTPS provider endpoint, configured only by the operator |
| `AI_MODEL` | Provider model identifier |
| `AI_REQUEST_TIMEOUT_MS` | Request timeout; clamped to a safe range |
| `AI_MAX_OUTPUT_TOKENS` | Maximum output token budget; clamped by Worker |
| `AI_SUPPORTED_CAPABILITIES` | Comma-separated capabilities: `chat,documents,agent,tool-calling` |
| `AI_ENABLED` | Master AI flag; must be exactly `true` |
| `AGENT_ENABLED` | Separate tool-calling flag; requires `AI_ENABLED` and agent capabilities |
| `AI_API_KEY` | Secret credential; never a Wrangler `[vars]` value and never sent to the browser |

The current default `AI_API_URL` and `AI_MODEL` in `wrangler.toml` are an Anthropic example only. Replace them with the chosen provider's correct endpoint/model when activating. Do not put the API key into source control or `wrangler.toml`.

## 5. Secure configuration and activation checklist

Do this only after the public website, privacy terms, cost controls, and tests are ready.

1. Choose the provider and confirm it supports the required chat and (if desired) tool-calling capabilities.
2. Configure `AI_PROVIDER`, `AI_API_URL`, `AI_MODEL`, `AI_REQUEST_TIMEOUT_MS`, `AI_MAX_OUTPUT_TOKENS`, and `AI_SUPPORTED_CAPABILITIES` in the Worker environment.
3. Store the credential as a Worker secret, never in frontend code or `[vars]`:

   ```powershell
   npx wrangler secret put AI_API_KEY
   ```

4. Keep `AGENT_ENABLED=false` for an initial chat-only rollout. Enable `AI_ENABLED=true` only after credential/provider verification.
5. Deploy the Worker, then verify `GET /api/features` reports the expected capabilities without exposing secrets.
6. Verify unauthenticated requests receive `401`, while authenticated requests use the server-side plan and atomic daily counters.
7. Test Free and Pro quotas, over-sized body/context rejection, rate limits, provider timeout/failure, invalid tool names, unknown file names, invalid tool options, and quota refund behavior.
8. Review privacy copy and show a clear disclosure before sending selected extracted text to the configured provider. The original document and image must remain local unless a separately designed feature explicitly requests otherwise.
9. Run `npm test`, `npm run build`, and `npm run preview`; perform Persian/English, RTL/LTR, mobile, and production-preview checks.
10. Enable `AGENT_ENABLED=true` only after local tool registry/argument/permission/confirmation tests pass. Agent tools are browser-local and must not gain arbitrary filesystem or network access.

## 6. Disable immediately / rollback

Set both master switches off and redeploy:

```toml
AI_ENABLED = "false"
AGENT_ENABLED = "false"
```

The Worker immediately returns `503` for the protected AI endpoints, and the frontend feature-status request causes the AI controls to return to the disabled state. Credentials can remain stored as Worker secrets during a pause, or be removed explicitly with the Cloudflare secret-management workflow.

## 7. Quotas and operational limits

- `/api/ai` uses the existing atomic `ai` counter: Free 3/day, Pro 200/day.
- `/api/assistant` and `/api/agent` use the existing atomic `agent` counter: Free 10/day, Pro 300/day, shared between the two endpoints.
- Translation continues using its independent `translate` counter and `TRANSLATION_ENABLED` flag.
- All daily counters use UTC dates. Requests rejected before quota reservation do not consume quota; provider errors/timeouts release the reserved counter.
- Short-window KV throttles supplement (but do not replace) atomic D1 quota enforcement.
- AI features do not store full conversation or document contents in D1. The existing usage counters contain only account ID, UTC day, quota type, and count.

## 8. Tests with no active API

The test suite must run without an AI API key and must not contact a third-party provider. `tests/assistant_infrastructure_check.py` checks the contracts and privacy boundary. `tests/assistant_worker_runtime.mjs` exercises feature flags, unauthenticated access, and disabled-route behavior while counting provider fetches; it asserts that no outbound provider fetch occurs with the flags disabled. Provider-response normalization can be tested using isolated fixtures, but those fixtures are never used as production AI responses.

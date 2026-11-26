# Security Configuration Guide

This guide describes the required deployment configuration for the current PDF & Image AI Tools Worker. It contains variable names and procedures only; it must never contain secret values.

## 1. Before deployment

1. Use the latest reviewed source and a clean, trusted development machine.
2. Restore/install dependencies from the reviewed lockfile. This supplied snapshot currently has no lockfile; generate one with the chosen package manager, inspect the resolved tree, run `npm audit`, and commit the lockfile before using `npm ci` in repeatable builds.
3. Run the complete test suite, production build and preview. Do not deploy while those checks are failing or blocked.
4. Replace placeholder values in `wrangler.toml`, especially `APP_URL`, `database_id`, and KV namespace `id`.
5. Use separate Cloudflare D1/KV resources and provider credentials for development and production.

## 2. Worker variables and secrets

### Non-secret variables

Configure these in the Worker environment (for example, `[vars]` in Wrangler or the Cloudflare dashboard):

| Name | Purpose | Guidance |
|---|---|---|
| `APP_URL` | Canonical browser origin and CORS allowlist | Exact HTTPS origin only, e.g. `https://app.example.com`; no path, query or trailing custom route. The placeholder `https://your-domain.com` is rejected. |
| `MAIL_FROM` | Verified sender identity for sign-in email | Must be a sender/domain verified with the email provider. |
| `STRIPE_PRICE_ID` | Server-side Stripe price identifier | Use the correct price for this environment; do not accept a price from browser input. |
| `ZARINPAL_AMOUNT_IRR` | Server-side Zarinpal amount | Must be a positive integer in the expected currency unit. |
| `AI_ENABLED` | Master AI switch | Keep `false`. |
| `AGENT_ENABLED` | Agent switch | Keep `false`. |
| `TRANSLATION_ENABLED` | Translation provider switch | Keep `false` until its provider and privacy requirements are separately approved. |
| `AI_PROVIDER`, `AI_API_URL`, `AI_MODEL`, timeout/output settings | Future provider metadata | Existing values do not activate AI on their own; keep flags disabled and do not add an AI key. |

### Secrets

Set these as Cloudflare Worker secrets. Do not put their values in `wrangler.toml`, source files, client-visible `VITE_*` variables, screenshots, logs, documentation, or commits.

| Secret name | Required? | Notes |
|---|---|---|
| `JWT_SECRET` | Yes | Use a cryptographically random value of at least 32 characters. It signs sessions and keys HMAC identifiers/OTP challenges. |
| `RESEND_API_KEY` | Yes for email login | Provider API key used only by Worker. |
| `STRIPE_SECRET_KEY` | Required for Stripe billing | Secret API key for the matching environment. |
| `STRIPE_WEBHOOK_SECRET` | Required for Stripe webhooks | Signing secret for the configured webhook endpoint. |
| `ZARINPAL_MERCHANT_ID` | Required for Zarinpal billing | Merchant configuration; treat as confidential. |
| `TURNSTILE_SECRET` | Optional | Set only when Turnstile verification is enabled and the matching site key is configured in the frontend. |
| `FEEDBACK_ADMIN_TOKEN` | Optional | At least 32 random characters; required for feedback export. Keep it in a trusted administrator secret store. |
| `AI_API_KEY` | **Must remain unset** | Do not configure while AI is disabled. Activation needs separate authorization. |

Set secrets interactively with Wrangler; the command prompts for the value:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put ZARINPAL_MERCHANT_ID
npx wrangler secret put TURNSTILE_SECRET
npx wrangler secret put FEEDBACK_ADMIN_TOKEN
```

Run only commands for services actually configured in that environment. Never pass secret values as command-line arguments, as they may be retained in shell history or process listings.

## 3. Generate and protect local secrets

- Use `.dev.vars` for local Worker development secrets. The file is ignored by Git; never commit it.
- Keep local `.env` files out of source control. Do not prefix Worker secrets with `VITE_`; Vite exposes `VITE_*` values to client bundles.
- Do not reuse production credentials in local or preview environments.
- If a secret is ever exposed, treat it as compromised even if the visible file is deleted.

## 4. Secret rotation

1. Generate a new secret with a reputable cryptographic random generator or the provider's credential console.
2. Add/rotate the new credential at the provider first when the provider supports overlap.
3. Update the Cloudflare Worker secret using `npx wrangler secret put SECRET_NAME` in the intended environment.
4. Verify the integration using provider sandbox/test events.
5. Revoke the old key at the provider and verify the old credential no longer works.
6. Review recent deployment history/logs for exposure without logging the credential itself.

**JWT_SECRET special case:** changing it invalidates existing signed sessions and changes HMAC derivation for rate-limit and OTP identifiers. Plan a controlled user re-authentication and allow old short-lived security buckets/challenges to expire; only rotate it when necessary, especially after suspected exposure. Do not rotate it casually.

## 5. CORS and browser origin

- `APP_URL` is the only allowed browser origin. Set it to the exact production application origin using HTTPS.
- Do not configure wildcard `Access-Control-Allow-Origin` or credentialed wildcard CORS.
- Ensure the frontend and `/api/*` Worker route use the intended same-origin setup.
- Webhook callbacks are handled as provider-to-Worker requests and are validated by their own signatures / payment authority flow; they are not browser CORS authentication.
- CORS is not authentication. Protected API routes still require valid server-verified bearer sessions.
- If the app changes hostname, update `APP_URL` deliberately and test preflight, login, and authenticated routes.

## 6. D1 configuration and migrations

`wrangler.toml` defines `migrations_dir = "worker/migrations"`. Phase 5 introduces additive migrations `0005_security_hardening.sql` and `0006_auth_challenges.sql`.

First configure a **separate development D1** database and use its ID in a development Wrangler environment. The following examples use the configured database name `pdf-ai`:

```bash
# Inspect migration state
npx wrangler d1 migrations list pdf-ai --local

# Apply migrations only to the local development database
npx wrangler d1 migrations apply pdf-ai --local

# After configuring a separate Cloudflare development database, inspect it
npx wrangler d1 migrations list pdf-ai --remote

# Apply only after reviewing the target and taking a backup
npx wrangler d1 migrations apply pdf-ai --remote
```

Do not point a development command at the production database. Before any production migration:

1. Confirm the active Cloudflare account, database name and ID.
2. Take and verify a current D1 backup/export using the Cloudflare-supported procedure.
3. Review migration SQL; migrations 0005/0006 should only add tables/indexes.
4. Apply to development first and run the Worker integration checks.
5. Obtain deployment approval, apply migrations 0005/0006 to the production D1 database **before** deploying the new Worker code (the updated Worker queries these tables). Then deploy the Worker and verify account login, logout revocation, usage/quotas, translation-disabled state, and scheduled cleanup.

Useful documentation: [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/) and [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/).

## 7. Rate limiting and scheduled cleanup

Worker request limits are enforced using atomic conditional UPSERTs in D1; HMACed bucket identifiers are stored rather than raw email/IP identifiers. Current windows include:

- OTP request: 10 requests/IP/hour and 5 requests/email/hour.
- OTP verify: 30 attempts/IP/10 minutes and 8 attempts/email/10 minutes.
- Feedback submission: 5 requests/IP/hour.
- Feedback export: 10 requests/IP/hour.
- Signed-in translation, AI, assistant and agent endpoints: separate short burst windows.
- Checkout attempts: limited per signed-in user.

The Wrangler cron is configured for daily cleanup at `03:00` according to Cloudflare cron semantics/UTC. Cleanup removes expired rate buckets, expired token revocations and OTP challenges, old daily usage counters and unpaid Zarinpal intents older than two days. Confirm the cron trigger is enabled in the deployed environment.

These application limits supplement Cloudflare platform protections; they are not a substitute for monitoring provider account limits or abuse patterns.

## 8. File and local-processing safeguards

- Keep OCR, PDF editing, image conversion and local workspace operations in the browser/device.
- Do not add document upload endpoints merely to simplify processing.
- Keep `isEvalSupported: false` on PDF.js document load options for untrusted documents.
- Keep `inspectZipArchive` checks before Office ZIP decompression.
- Keep file extension/MIME/signature, file size, page, pixel, archive entry and expanded-size limits.
- Do not enable arbitrary URL import/remote fetching without a separately reviewed allowlist/SSRF design.
- Do not weaken CSP to `*` or add arbitrary inline script allowances to make a tool work. If a new static asset host is required, add the exact domain to only the directives that need it and document the data exposure.

`public/_headers` contains the Pages response-header policy. If deploying on a host other than Cloudflare Pages, replicate and verify the intended security headers in that host's configuration.

## 9. Authentication/session notes

The existing frontend stores the signed bearer token in browser `localStorage`. It is not application-encrypted. The Worker now checks signature, UID, expiry and revocation, but browser-side token storage remains exposed to same-origin script execution. Maintain strict XSS controls, avoid unsafe HTML insertion, and do not install unreviewed third-party scripts. A move to HttpOnly cookies requires a separately planned CSRF/session migration.

## 10. Deployment verification checklist

- [ ] Production `APP_URL` is the exact HTTPS origin; placeholder domain removed.
- [ ] Privacy/Terms page business name and contact email placeholders are replaced with verified operator details and reviewed before public launch.
- [ ] D1 database ID and KV namespace ID point to the intended environment.
- [ ] `JWT_SECRET` is at least 32 random characters and stored as a Worker secret.
- [ ] Email/payment/Turnstile secrets exist only where the respective service is enabled.
- [ ] No production secrets appear in `[vars]`, `.env`, `.dev.vars.example`, source, or frontend build output.
- [ ] Migrations 0005 and 0006 have been tested against a separate development D1 first.
- [ ] Worker CORS, 405 behavior, request-size rejection and authenticated route behavior have been verified on the deployed development Worker.
- [ ] Stripe webhook signature and Zarinpal callback were tested using provider sandbox/test credentials.
- [ ] AI and Agent flags remain `false`; no AI API key has been configured.
- [ ] Translation flag remains `false` until explicit approval.
- [ ] `npm audit`, full `npm test`, `npm run build` and `npm run preview` pass with a committed lockfile.
- [ ] Git history has been scanned for secrets; any discovered credential has been rotated, not merely deleted.

Do not publish/deploy the supplied placeholder configuration as-is.

# Phase 5 – Security, Privacy & Data Protection Report

**Project:** PDF & Image AI Tools  
**Report date:** 2026-11-22  
**Baseline:** Phase 4 Bugfixes ZIP supplied for this task  
**Status:** Security hardening implemented in the local project snapshot; production verification remains incomplete.

> This report is an engineering assessment of the inspected source snapshot and the tests listed below. It is not a penetration-test certification, a guarantee of security, or a legal-compliance assessment.

## 1. Audit scope and limitations

Inspected the application source, Worker endpoints, D1 schema and migrations, file-validation and ZIP-import paths, session helper, entitlement/usage logic, AI adapter, privacy text, Wrangler configuration, Pages response headers, package scripts, and existing test suite.

The supplied ZIP does not contain Git metadata. There is no `.git` directory, dependency lockfile, `node_modules`, `.env`, or `.dev.vars` in the working copy. No authenticated GitHub or Cloudflare deployment session was available. Consequently:

- Git history and already-removed secrets could not be reviewed.
- `npm audit` could not run because npm requires a lockfile; it returned `ENOLOCK`.
- The updated dependency graph could not be installed or resolved in this environment.
- Production D1 migrations, live provider configuration, real account isolation, and Cloudflare deployment were not exercised.
- Worker runtime tests use a deterministic mock D1 and mocked external provider responses, not production accounts or real customer content.

The Phase 5 D1 migrations were tested against a local SQLite copy of the existing schema. They have **not** been applied to a Cloudflare database.

## 2. Severity summary

| Severity | Finding / change | Status |
|---|---|---|
| High | Old `fflate` dependency had a malformed ZIP/ZIP64 denial-of-service advisory; dependency range moved to `^0.8.3`. Office ZIP imports already pass through structural pre-validation and bounded decompression. | Fixed in source/config; dependency install/build pending |
| High | Old PDF.js release was within the affected range for CVE-2024-4367 when eval support is enabled. All application `getDocument()` call sites now set `isEvalSupported: false`; dependency range moved to `^4.2.67`. | Mitigation in source; dependency install/build pending |
| High | Vite range moved from 5.x to security-patched Vite 6.4.6; React plugin updated to a Vite 6-compatible release. Current dev config has a proxy but does not configure a network-wide `server.host`. | Config updated; dependency install/build pending |
| Medium | OTP records previously allowed a database-only observer to test low-entropy code candidates if hashes were plain. Codes and email identifiers now use server-keyed HMAC. | Fixed; runtime test passed |
| Medium | OTP challenge consumption could race when read/delete were separate. It is now a single conditional `DELETE ... RETURNING`. | Fixed; concurrent runtime test passed |
| Medium | Abuse counters used a non-atomic KV read/update pattern. Auth and other request throttles now use conditional D1 UPSERT operations with HMACed bucket identifiers. | Fixed; runtime/SQLite tests passed |
| Medium | Invalid sign-in CAPTCHA attempts could call the external Turnstile verifier before local throttling. IP/email throttles now run before the provider request. | Fixed; runtime/static tests passed |
| Medium | Logout previously cleared only browser state. It now stores a hash of the current token in `revoked_tokens`, and authentication checks that table. | Fixed; runtime test passed |
| Medium | PDF Editor and Scan Center had upload paths that did not check file signatures consistently. Both now validate MIME/extension agreement and PDF/image magic bytes. | Fixed; runtime/static tests passed |
| Medium | API routes did not have a single explicit method allowlist and request size cap across body readers. Methods, body size, CORS origin, response headers, provider redirects and payment return URLs are now constrained. | Fixed in source; tested with Worker mocks |
| Medium | Authenticated browser token remains in `localStorage`. This is not encrypted by the application and can be exposed by an application-origin XSS. | Residual risk; architecture retained |
| Low | The source snapshot has no lockfile, so transitive dependency versions and npm audit advisories are unknown. | Open blocker |
| Informational | No live Cloudflare deployment or Git-history scan was possible. | Open verification item |

## 3. Files and components changed

The Phase 5 snapshot differs from the supplied Phase 4 ZIP in the following main areas (TypeScript sources are paired with `.js` runtime modules where the project resolves JavaScript mirrors):

- **Worker / D1 / deployment:** `worker/index.ts`, `worker/schema.sql`, `worker/migrations/0005_security_hardening.sql`, `worker/migrations/0006_auth_challenges.sql`, `wrangler.toml`.
- **File parsing and validation:** new `src/core/file-signatures.ts`/`.js` and `src/core/zip-safety.ts`/`.js`; updates to `src/core/file-validation.ts`/`.js`, `src/core/document-extract.ts`/`.js`, OCR, PDF compression and PDF text extraction modules.
- **Direct document import paths:** `src/ui/PDFEditor.tsx`/`.js`, `src/ui/ScanCenter.tsx`/`.js`, plus Word, Excel and PowerPoint workspace import handling.
- **Privacy and browser security:** `src/ui/App.tsx`/`.js`, `src/ui/Legal.tsx`/`.js`, `index.html`, new `public/theme-init.js`, new `public/_headers`, `.gitignore`.
- **Tests:** new `tests/worker_security_runtime.mjs`, `tests/file_security_runtime.mjs`, and `tests/security_static_check.py`; updates to SQLite migration tests and existing translation, document-AI, assistant, UI and regression tests.
- **Project metadata/docs:** `package.json`, `README.md`, and the two documents under `Documentation/Security/`.

The repository snapshot has no `.git` metadata, so this list was obtained by comparing the supplied Phase 4 ZIP contents with the updated working tree, not from Git status or commit history.

## 4. Authentication and session security

- Worker identity is derived from a signed HMAC bearer token, not a frontend-supplied user ID.
- Token payload UID and expiry are type/length/range checked; signature comparison uses the constant-time helper.
- User records are loaded by the signed UID using bound SQL parameters and an explicit column list.
- Logout now inserts a SHA-256 hash of the current bearer token into `revoked_tokens`; subsequent authenticated requests reject it.
- OTP request throttles are applied per HMACed IP and email identifiers before the external Turnstile verifier is called. Verify attempts have separate IP/email windows.
- OTP challenge storage contains HMACed email and code values only. The OTP is short-lived (10 minutes) and consumed atomically once.
- Invalid or unavailable mail/Turnstile configuration returns an unavailable/error response; no successful login is simulated.

**Residual:** bearer tokens are still stored by the frontend in `localStorage`, and token lifetime remains 30 days. This preserves the existing session architecture but means an application-origin XSS could read an active token. A future cookie-based `HttpOnly`, `Secure`, `SameSite` session design would require a separate CSRF/compatibility migration and is not introduced here.

## 5. Authorization and user-data isolation

Protected Worker routes resolve the current user from the validated token. The `/api/me` response exposes only the account and usage fields needed by the client. Quota rows are scoped by the authenticated user ID. Stripe and Zarinpal entitlement changes are applied from provider callbacks and server-side records, not frontend plan fields.

The runtime security test verifies that a forged UID does not grant access to another user and that a revoked token fails. SQLite tests verify that per-user quota keys remain distinct.

**Limitation:** these checks were not run against two real Cloudflare test accounts. The current project does not provide cloud document storage endpoints; document processing and workspace files remain browser-local in the inspected flow.

## 6. Worker and API hardening

Implemented:

- Explicit HTTP method allowlist for each API route; unsupported methods return 405 with `Allow`.
- Unknown routes return 404.
- Request text is streamed with a byte cap; declared and observed body size are checked.
- CORS responds only for the exact configured `APP_URL` origin. Wildcard CORS and credentialed CORS are not enabled.
- `APP_URL` must be a valid HTTPS origin (HTTP is accepted only for localhost/127.0.0.1 development), with no path/query/fragment or user information; the placeholder domain is rejected.
- `Origin` and `Sec-Fetch-Site` are checked on same-origin application routes. Provider callbacks are explicitly exempt because their request origin is not the browser application.
- Security headers include `nosniff`, frame denial, strict referrer policy, CORP same-origin, API CSP, `no-store`, and HSTS for HTTPS requests.
- External provider fetches use `redirect: "error"` to prevent redirects from forwarding bearer secrets to a different destination.
- Stripe and Zarinpal return/checkout URLs are validated against HTTPS and expected provider hosts.
- Errors returned to the client are normalized; unexpected Worker errors return a generic internal error.

CORS is not treated as authentication. Protected endpoints still require a valid bearer token. Stripe webhooks require their signed timestamped signature and enforce a short replay window. Feedback export requires a separately configured high-entropy admin token and is rate-limited.

## 7. D1 database and migration findings

All reviewed dynamic values in Worker SQL are passed through prepared-statement bindings. Added two non-destructive migrations:

- `worker/migrations/0005_security_hardening.sql`: `security_rate_limits` and `revoked_tokens`, with expiry indexes.
- `worker/migrations/0006_auth_challenges.sql`: `auth_challenges`, with an expiry index.

The migrations create tables/indexes only; they do not drop or rewrite existing user, subscription, quota, feedback, or payment records. Local SQLite validation applied both migrations to a copy of the previous schema and confirmed existing account data remained present.

The scheduled cleanup removes expired rate-limit records, revoked-token records after token expiry, expired OTP challenges, prior-day usage counters, and unpaid Zarinpal intents older than two days. Paid payment records are retained for reconciliation.

**Deployment blocker:** apply and verify migrations in a separate development D1 database before production. For rollout, back up production, apply migrations 0005/0006 first, then deploy the Worker code that queries the new tables. Do not apply them to production from this ZIP without a fresh backup and deployment review.

## 8. File processing and document safety

- General file validation checks accepted extension/MIME pairing, signatures for PDF/JPEG/PNG/WEBP, file counts, individual/aggregate byte sizes, PDF page counts, and image pixel dimensions.
- PDF Editor and Scan Center now perform their own signature checks before their direct processing paths.
- Every inspected TypeScript `pdfjs.getDocument()` call sets `isEvalSupported: false` for untrusted documents.
- Office packages are inspected before `fflate` decompression. The ZIP safety layer rejects ZIP64, encrypted/unsupported flags, malformed ranges, duplicate/unsafe names, path traversal, excessive entries and excessive declared expanded size. The application processes ZIP entries in memory and does not extract archive paths to a server filesystem.
- No application endpoint was found that uploads source PDFs/images to the Worker for local OCR or local document editing.
- Object URL and worker cleanup paths were reviewed in the existing local processing flows; browser resource lifecycle remains a regression-test area when changing those components.

Dependency upgrades are part of the hardening, but cannot be fully verified until the packages are installed and the full Office/build tests run.

## 9. Subscription, quotas and translation

- Paid plan status is derived on the Worker from server-side account fields and verified payment-provider callbacks.
- Translation daily quota is consumed through a conditional D1 UPSERT scoped by user, UTC day, and usage type.
- AI and agent usage counters are separate; AI-disabled requests are rejected before quota use.
- Request burst limits are also maintained in D1 to coordinate across Worker instances.
- Browser-side restrictions for local file tools remain usability limits, not tamper-proof security controls. Local PDF/image operations cannot be secured by a frontend entitlement check; server-side paid API privileges are enforced independently.
- Translation sends only the explicitly submitted text to the provider when the feature is enabled and credentials exist. In this snapshot `TRANSLATION_ENABLED` remains `false`; provider availability is not fabricated.

## 10. AI Assistant status

AI and Agent flags remain `false` in `wrangler.toml`. No AI API key is defined in source configuration. Worker routes reject calls while the relevant feature flag is disabled; runtime testing observed no external AI fetch when disabled. The frontend feature-status request is to the application's own Worker only.

No AI provider API was activated, configured, or called during this phase. Do not add `AI_API_KEY` or enable AI flags without a separate owner authorization and a documented privacy review.

## 11. Local-First privacy and retention

Observed data flows:

- Source PDFs, images, OCR, PDF editing, and local workspace operations are processed/stored in the browser/device in the inspected implementation; there is no general document-upload endpoint in the Worker routes.
- Local OCR may fetch Tesseract worker/core/language assets from jsDelivr. The CDN can observe connection metadata such as the visitor IP and requested static asset; the scanned document bytes are not sent to the CDN by that asset download.
- Fonts may load from Google Fonts as allowed by the current Pages CSP.
- Translation content is sent only after the user initiates the translation operation; only text is sent, not the original document or image. Translation is currently disabled by configuration.
- D1 stores account identifiers/email, subscription-provider identifiers/status, daily usage counters, feedback submissions, short-lived HMACed security buckets, token-revocation hashes, OTP challenge HMACs, and payment reconciliation rows.
- Browser session token is in `localStorage`; local workspace data may use IndexedDB with a bounded localStorage fallback. Browser storage is not application-encrypted and is under browser/device control.

Retention reflected in implementation:

- OTP challenges expire after 10 minutes and are removed by the daily cleanup task.
- Rate-limit buckets expire at the end of their short window and are cleaned on the scheduled run.
- Token revocations are retained until token expiry, then cleaned.
- Usage counters from previous UTC days are removed by the scheduled cleanup.
- Unpaid Zarinpal payment intents older than two days are removed; paid records remain for reconciliation.
- Feedback submissions and account records have no automatic age-based deletion in the inspected cleanup task.
- Account deletion is not currently self-service or automatic; the published privacy wording was corrected to avoid claiming otherwise. Account removal requires an operator-managed process.

This report does not claim encryption at rest for browser storage, GDPR compliance, or any security certification.

## 12. Secrets and environment configuration

Expected Worker configuration names include:

**Secrets (set with Wrangler secret management; do not put values in `wrangler.toml` or frontend `VITE_*` variables):**

- `JWT_SECRET` – required, at least 32 characters, used for token signing and HMACed identifiers/OTP values.
- `RESEND_API_KEY` – required for email OTP delivery.
- `STRIPE_SECRET_KEY` – required for Stripe billing operations.
- `STRIPE_WEBHOOK_SECRET` – required for Stripe webhook validation.
- `ZARINPAL_MERCHANT_ID` – private merchant configuration for Zarinpal.
- `TURNSTILE_SECRET` – optional if Turnstile verification is enabled.
- `FEEDBACK_ADMIN_TOKEN` – optional; required to export feedback, minimum 32 characters.
- `AI_API_KEY` – not required and must remain unset while AI is disabled.

**Non-secret Worker vars/configuration:** `APP_URL`, `MAIL_FROM`, `STRIPE_PRICE_ID`, `ZARINPAL_AMOUNT_IRR`, `AI_ENABLED`, `AGENT_ENABLED`, `TRANSLATION_ENABLED`, provider/model/timeout settings. The placeholder `APP_URL` and placeholder IDs in the supplied `wrangler.toml` must be replaced for a deployment. Do not store private credentials in `[vars]`.

No `.env` or `.dev.vars` secret file was present in the supplied snapshot; `.gitignore` excludes these files while allowing safe example files.

## 13. Dependency and supply-chain review

The supplied repository snapshot has no package lockfile. `npm audit` returned `ENOLOCK`; it did not perform an advisory scan. A complete direct/transitive inventory and Git-history secret scan therefore remain outstanding.

Security-motivated package range changes in `package.json`:

- `fflate`: `^0.8.2` → `^0.8.3` (malformed ZIP/ZIP64 decompression denial-of-service fix).
- `pdfjs-dist`: `^4.0.379` → `^4.2.67` (PDF.js 4.x release containing the CVE-2024-4367 fix; eval support is also explicitly disabled at document load sites).
- `vite`: `^5.4.2` → `^6.4.6` (security-patched Vite 6 branch).
- `@vitejs/plugin-react`: `^4.3.1` → `^4.3.4` (Vite 6 peer compatibility).

The Vite advisory requiring dev-server exposure via `--host`/`server.host` was checked against the current `vite.config.ts`; it configures an API proxy but does not set a network-wide host. Do not expose the development server to untrusted networks.

These ranges are not equivalent to a verified resolved dependency tree. On a trusted development machine, install and lock exact compatible versions, run `npm audit`, inspect all transitive findings, then commit the generated lockfile.

References:

- [Vite GHSA-p4f5-76q4-ffq7](https://github.com/advisories/GHSA-p4f5-76q4-ffq7)
- [fflate advisories](https://github.com/advisories?query=fflate)
- [PDF.js CVE-2024-4367](https://nvd.nist.gov/vuln/detail/CVE-2024-4367)
- [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/)
- [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)

## 14. Automated verification results

The following were executed against the local snapshot and passed. In total, **24 project test scripts passed when invoked independently** (including the Phase 5 security scripts and the existing workspace/regression checks):

- `npm run test:security` – local SQLite schema/migration/atomic quota checks and static security checks.
- `npm run test:security-runtime` – mocked Worker runtime checks including user identity isolation, tampered UID rejection, logout revocation, OTP single-use/concurrent verification, Turnstile pre-throttling, CORS, method/body limits, security headers and AI-off behavior.
- `npm run test:file-security` – MIME/signature and malicious/malformed ZIP checks.
- `npm run test:translation-runtime` and `npm run test:assistant-runtime` – mocked endpoint behaviour; AI remained disabled.
- Existing Word, Excel, PowerPoint, storage, OCR/document intelligence, workflow, navigation, workspace, device-folder, entitlement and Phase 4 regression checks listed in the project test scripts were executed individually and passed, except the Office runtime dependency prerequisite described below.

Blocked / not completed:

| Command | Result | Reason |
|---|---|---|
| `npm test` | BLOCKED | Stops at `test:office-runtime`: `typescript` package is missing from `node_modules`; subsequent Office package fixture is therefore not generated. The other 24 scripts were invoked independently and passed. |
| `npm run build` | BLOCKED | TypeScript compiler cannot resolve React, PDF, Tesseract, fflate, pdfjs-dist and Vite module types because dependencies are not installed; this is not a successful build. |
| `npm run preview` | BLOCKED | `vite` executable is absent (`vite: not found`). |
| `npm audit` | BLOCKED | No package lockfile; npm returns `ENOLOCK`. An attempt to create one with `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` timed out while contacting the registry and left no partial lockfile. |
| Live D1 migration / live account isolation | NOT TESTED | Requires a separate Cloudflare development account/database. |
| Real payment / email / Turnstile provider checks | NOT TESTED | Requires provider credentials and safe sandbox environments. |

Do not mark Phase 5 production-ready until the blocked checks are rerun successfully after dependency installation and development-D1 deployment.

## 15. Remaining risks and Phase 5 follow-up

1. Create and commit a lockfile after resolving/installing the updated dependency ranges; run `npm audit` and review all transitive vulnerabilities.
2. Execute `npm test`, Office archive tests, `npm run build`, and `npm run preview` on the installed, locked dependency graph.
3. Apply migrations 0005 and 0006 to a separate development D1 database and run the Worker integration tests against it; only then plan production migration with backup and owner approval.
4. Validate cross-account denial using two disposable test accounts in a development environment.
5. Review token storage strategy and XSS posture in a separate session-design change; current `localStorage` token remains an acknowledged risk.
6. Review Git history for accidentally committed secrets using the actual repository. Rotate any discovered credential with its provider; deleting it from the working tree alone is insufficient.
7. Configure real `APP_URL`, D1 and KV IDs and set the required secrets through Cloudflare secret management. Do not deploy the placeholder configuration.
8. Replace the legal-page placeholders (`support@your-domain.com` and `[Business name]`) with the operator's verified contact/business details and obtain a separate legal review before public launch.
9. Keep AI/Agent/Translation flags disabled unless each integration receives explicit approval and its data transfer is documented.

**Conclusion:** Source-level security hardening and isolated tests are implemented. Phase 5 is not yet fully accepted for production because dependency installation/audit/build, live D1 migration, Git-history scanning and real development-account verification remain blocked or untested.

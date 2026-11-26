# PDF & Image AI Tools (fa/en)

## اجرا / Run
npm install
npm run dev           # frontend
npm run worker:dev    # worker (another terminal)
npm run build         # type-check + production build
npm run test:security # test critical D1/SQLite invariants locally
npm run test:word     # validate Word Workspace OOXML structure
npm test              # run security, Office, local workspace and folder-storage checks

## راه‌اندازی Worker / Worker setup
npx wrangler kv namespace create KV                # id → wrangler.toml
npx wrangler d1 create pdf-ai                      # id → wrangler.toml
# New database: run the current schema once (it includes the feedback table).
npx wrangler d1 execute pdf-ai --file=worker/schema.sql --remote
# Original pre-stabilization database: run 0002 exactly once BEFORE schema.sql.
# npx wrangler d1 execute pdf-ai --file=worker/migrations/0002_stripe_subscription.sql --remote
# Already-stabilized database that predates feedback: run 0003 exactly once.
# npx wrangler d1 execute pdf-ai --file=worker/migrations/0003_feedback.sql --remote
npx wrangler secret put JWT_SECRET
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
npx wrangler secret put ZARINPAL_MERCHANT_ID
npx wrangler secret put FEEDBACK_ADMIN_TOKEN  # کلید تصادفی و محرمانه، حداقل ۳۲ کاراکتر

- Stripe webhook: https://YOUR_DOMAIN/api/billing/stripe/webhook (checkout.session.completed / checkout.session.async_payment_succeeded, customer.subscription.created/updated/deleted, invoice.paid)
- Required secret: JWT_SECRET must contain at least 32 characters. Set STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY and RESEND_API_KEY with `wrangler secret put`. Do not configure or enable AI secrets/flags until the AI activation phase is explicitly approved.
- Zarinpal callback: /api/billing/zarinpal/callback (خودکار)
- Resend: دامنه فرستنده را تأیید کنید

## Account registration and sign-in / ثبت‌نام و ورود
- The top navigation now provides separate **Create account** and **Sign in** actions, and the auth panel lets users switch between these modes. Both use passwordless email one-time codes. After a valid code is verified, the Worker creates a user record if the email is new; existing users are signed in without creating duplicates.
- Account creation requires a deployed Worker with `RESEND_API_KEY`, a verified `MAIL_FROM` sender/domain, `JWT_SECRET`, and the D1 auth challenge migration (`0006_auth_challenges.sql`) applied to existing databases. New databases receive the `auth_challenges` table from `worker/schema.sql`.
- The email code expires after 10 minutes and is single-use. No password is stored by this authentication flow.

## ابزار جدید / New tool
src/tools/<id>/index.ts → export default Tool

## Stripe Customer Portal
در داشبورد Stripe: Settings → Billing → Customer portal را فعال و پیکربندی کنید (لغو اشتراک، به‌روزرسانی کارت، نمایش فاکتورها). برای حالت Test و Live جداگانه انجام می‌شود.
دکمه «مدیریت یا لغو اشتراک» برای کاربری که stripe_customer دارد ظاهر می‌شود. لغو در پایان دوره باعث می‌شود invoice.paid بعدی نیاید و پلن خودش منقضی شود؛ لغو فوری با customer.subscription.deleted اعمال می‌شود.


## Stabilization notes
- Daily AI and assistant quotas are stored in D1 and enforced with atomic conditional upserts. A daily Worker Cron removes prior-day counters and unpaid Zarinpal intents older than 48 hours; paid receipts remain for reconciliation.
- Stripe webhook event IDs are deduplicated in D1; subscription access is synchronized to the actual billing-period end rather than incremented by a fixed number of days. The handler accepts both older Stripe fields and the newer Basil item-level period / invoice-parent fields.
- Zarinpal authorities are stored in D1 with their user and amount. A D1 batch marks a payment paid and grants the 30-day pass once.
- Run the updated `worker/schema.sql` against D1 before deploying the Worker. For a database created with the earlier schema, run `worker/migrations/0002_stripe_subscription.sql` exactly once before applying the updated schema. The rest of the schema uses `CREATE TABLE IF NOT EXISTS` and is safe to re-run.
- Local file tools are client-side by design. Their file-count/size/page limits protect browser stability and the Pro batch gate is a user-interface entitlement, not a tamper-proof server-side security boundary. Strong enforcement would require moving file processing to a trusted server or a separately verified entitlement flow.
- Browser-side safety limits: 50 MB per file, 100 MB per operation, at most 50 files, 300 pages per PDF by default (lower limits for OCR / selected tools), 500 total PDF pages, 32 million pixels per image and 80 million image pixels per operation. API endpoints, sign-in, AI and payments still require an internet connection.
- Before public launch, replace the sample domain, sender address, support email, legal operator name, refund policy and governing-law placeholders in the app and `wrangler.toml`.

## Feedback collection / دریافت بازخورد کاربران
- The public app includes a bilingual feedback page (`/#feedback`) for bug reports, feature requests, usability notes and general comments. It accepts a rating and optional reply email; visitors must not submit document contents.
- Apply `worker/migrations/0003_feedback.sql` once to existing databases. New databases receive the table from `worker/schema.sql`.
- Set a random `FEEDBACK_ADMIN_TOKEN` Worker secret (at least 32 characters). In the app's Feedback page, open Administrator export and enter the token to download a CSV. The token is never stored in browser storage or shipped in the frontend.
- Feedback IP addresses are not stored; an HMAC-derived temporary KV rate-limit key limits feedback to 5 submissions/hour and CSV export requests to 10/hour per IP. Feedback records are retained until manually removed under the operator's retention policy.

## Phase 1 PDF editor
- The browser-based editor supports PDF preview, page reordering, rotation, deletion, extraction, text-note overlays, a drawn signature and basic AcroForm text/checkbox fields. The original PDF is not uploaded.
- Text notes are raster overlays (not editable PDF text). AcroForm appearance regeneration uses Helvetica; inspect Persian text fields before using the output commercially.
- OCR exports the recognized TXT text. For PDFs, the additional hidden searchable layer currently includes ASCII/English words only because the bundled standard PDF font does not contain Persian glyphs. Persian text remains available in the TXT export.

## Phase 2 – Scan Center / مرکز اسکن هوشمند
- A new `/#scan` tab accepts JPG/PNG/WEBP images and scanned PDF files, rendering PDF pages locally to images; up to 20 total pages are supported. The camera button uses the browser's mobile capture chooser where supported; on desktop it opens the regular file picker.
- Pages can be reordered, removed, rotated by 90 degrees, and processed in original color, grayscale/contrast, or black-and-white threshold mode.
- OCR supports `fas+eng`, `fas`, or `eng` using the existing Tesseract.js dependency. A user-drawn rectangle selects exactly which region of the current page is processed; by default, the same normalized region is applied to all pages, or this option can be turned off for page-specific regions. The browser may download traineddata on first use. For self-hosting, set `VITE_TESSDATA_URL` to a directory containing the matching Tesseract `.traineddata.gz` files and rebuild the frontend.
- Recognized text can be edited page by page. Export generates a multi-page A4 PDF that retains the scanned page images, plus editable DOCX and UTF-8 TXT files when OCR has completed.
- The PDF receives an invisible searchable layer for ASCII/English OCR words using pdf-lib's built-in Helvetica. Persian OCR is preserved in the DOCX and TXT outputs; a searchable Persian PDF layer still requires a properly licensed embedded Unicode font and is not claimed in this phase.
- Local limits: 20 pages, 50 MB per image, 100 MB combined, 32 megapixels per image and 80 megapixels combined. Files are processed in the browser and are not uploaded to the Worker.
- The separate PDF OCR tool enforces a 30-page Free limit and a 100-page Pro limit before processing; its PDF-rendering loop supports the same 100-page Pro ceiling.
- This phase does not yet include automatic page-edge detection, perspective correction, manual crop handles, handwriting OCR, or HEIC/HEIF input.
- `npm run preview` starts Vite's production preview server after `npm run build`.

Optional OCR language data hosting example:
```env
VITE_TESSDATA_URL=/tessdata
```
Place `fas.traineddata.gz` and/or `eng.traineddata.gz` in the corresponding public directory. The variable is a build-time frontend setting; it is not a secret.


## Phase 3 – Word Workspace / فضای کار Word
- A new `/#word` tab provides a browser-based lightweight editor. It opens DOCX and UTF-8 TXT files, and exports editable DOCX.
- Common DOCX structures are imported: paragraphs, headings, inline bold/italic/underline/strike, basic text color/size, paragraph alignment, simple numbered/bulleted lists and tables. Text direction is inferred for Persian/Arabic paragraphs.
- Editing tools include bold, italic, underline, paragraph/heading styles, alignment, simple lists, text color and a 3×3 table insert. Pasting is plain-text only in this release to avoid importing arbitrary HTML.
- Restored Word drafts are sanitized against a formatting allow-list before rendering, saving, DOCX export and print preview; active HTML, event attributes, embedded objects and unapproved CSS are not retained.
- PDF output uses the browser print dialog: choose **Save as PDF**. It is not a direct PDF download and depends on browser print support.
- Local limits: DOCX/TXT upload up to 20 MB, estimated uncompressed ZIP contents up to 100 MB, and editor content up to 1.5 million characters. DOCX ZIP64 packages are not supported yet.
- Known limitations: legacy `.doc` is unsupported; images, charts, SmartArt, embedded objects, headers/footers, footnotes/endnotes, tracked changes, comments, page-layout features and complex numbering are not preserved. Some styles may be simplified. Always review important documents in Microsoft Word or LibreOffice before relying on the export.
- Files are parsed and generated in the browser; they are not uploaded to the Worker.

## Phase 4 — Excel Workspace and Word page preview

The local spreadsheet workspace supports basic `.xlsx`, `.csv`, and `.tsv` files. In addition to cell editing, formula bar, search and XLSX/CSV export, it now includes AutoSum, arithmetic and `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, and `PRODUCT` formulas, circular-reference detection, multi-cell paste from a copied Excel range, Enter/Tab navigation, undo/redo (bounded history), adding/deleting rows and columns, and sorting the selected column with an option to keep the first row as a header. Formula exports include cached values when the local evaluator can calculate them.

Limits and known gaps: 15 MB source file, 80 MB maximum ZIP-expanded size, 500 rows × 100 columns; import currently reads the first worksheet and export creates one worksheet. Advanced formatting, charts, macros, multiple-sheet preservation, and full Excel formula compatibility are not included. Only the listed formula subset is evaluated; this is not a complete calculation engine.

Word Workspace renders an A4 page-break preview with a page counter as the content grows. The editable DOM remains a continuous document; the browser's print engine performs actual page breaks when exporting to PDF. It is not a full Word pagination engine yet.

## Phase 5 — PowerPoint Workspace / فضای کار ارائه‌ها

- A new `/#ppt` tab can create simple presentations and import `.pptx` files.
- Slide list operations: add, duplicate, delete, select, and move slides up/down.
- Edit slide title and body text; choose from six solid background colors; Persian/Arabic text uses RTL paragraph alignment.
- Export creates an editable PPTX package with text boxes and background colors; also export a plain-text outline or use browser Print → Save as PDF.
- PPTX import extracts slide text in presentation order. Images, charts, animations, SmartArt, speaker notes, embedded media and complex formatting are not preserved. It is a lightweight text-and-background editor, not a full Microsoft PowerPoint replacement.
- Local safety limits: 20 MB input, up to 100 MB expanded ZIP content and 60 slides.

Run `npm test` for the D1/SQLite, DOCX, XLSX and PPTX checks, including generation and OOXML package validation. `npm run preview` previews the production build after `npm run build`.

## Phase 6 — AI Document Intelligence and precise OCR regions

- A new `/#documents` workspace accepts up to 10 PDF, DOCX, XLSX, PPTX, TXT, CSV or TSV files (20 MB each, 60 MB combined). It extracts text locally in the browser and can ask questions across documents, summarize, compare, extract structured facts, translate, or draft a PowerPoint outline.
- Source labels are included for evidence review: PDF page, DOCX paragraph, XLSX sheet/cell, and PPTX slide number. PPTX extraction follows the slide order stored in `ppt/presentation.xml` and its relationships, not just ZIP filename order.
- The extraction and analysis UI is implemented, but AI model access is intentionally disabled in the current release. No text, prompt, image or tool result is sent to `/api/ai` while the public Worker feature status reports AI disabled and Worker `AI_ENABLED = "false"`. The original files are processed locally.
- Scan Center accepts JPG, PNG, WEBP and scanned PDF files. A PDF is rendered locally into page images so the user can choose OCR regions on each page. This rasterization does not preserve original vector/text objects; output is a new scan-oriented PDF plus editable DOCX/TXT. Up to 20 pages, 50 MB per input file, 100 MB combined, 32 megapixels per page and 80 megapixels total are enforced.
- Draw a rectangle over the exact reading area on the selected page. The normalized selection is applied to all pages by default; turn off “Apply this area to all pages” to set a different rectangle on each page. OCR receives only the cropped region. The full-page image is still kept in the PDF output, while the invisible OCR text boxes are mapped back to their correct positions on the page.
- OCR enhancement can upscale selected areas up to 2.5× (with a pixel safety cap), apply grayscale/contrast correction, and choose Tesseract page segmentation modes for automatic layout, a single dense text block, or sparse text. OCR confidence is shown as an approximate engine score, not a guarantee of correctness. Handwriting and low-quality photographs can still be inaccurate.
- Scanned PDF extraction in the AI Documents workspace is not run automatically. For a scanned PDF, open it in Scan Center, set the desired reading area(s), run OCR, export TXT/DOCX, then add that text file to AI Documents. The AI workspace only extracts selectable text from PDF files.
- Only PDF, DOCX, XLSX, PPTX, TXT, CSV and TSV are accepted in the AI Documents tab; legacy binary Office formats such as `.doc`, `.xls` and `.ppt` are not supported. XLSX reads up to 10 worksheets and 5,000 populated cells. PPTX text extraction handles up to 100 slides. Embedded images, diagrams and charts are not OCR'd by the AI Documents parser; use Scan Center for image content.
- Worker AI request bounds and authenticated API scaffolding remain prepared for a future activation phase. Do not set `AI_ENABLED` to `true` or configure an AI provider key in the current release. Local extraction and Scan Center OCR do not require the Worker AI API.
- `npm test` includes a dedicated `test:document-ai` check for local extraction, ROI OCR boundaries, source citations and request bounds. AI connection remains disabled in the current release.

## Phase 7 — Connected workflows and visual refresh

Phase 7 adds short-lived, in-memory handoffs between the document workspaces:

- Scan Center OCR text can be sent directly to Word Workspace, AI Documents or Translator without downloading and re-uploading a text file. Corrected text is transferred from the editable transcript. In multi-page scans, pages that have completed OCR can be transferred on their own; pages not yet processed are omitted and their original page numbers are retained.
- Word Workspace content can be sent to AI Documents for analysis.
- AI Documents analysis results can be opened in Word Workspace for further editing.
- Transfers stay in React application memory and are cleared after the receiving workspace consumes them; they are not written to local storage or uploaded automatically.
- AI processing remains disabled in this release. The Analyze action stays unavailable; no document text is sent to the Worker or an AI model provider.

The home view now includes a six-card workspace hub for Scan & OCR, PDF Editor, Word, Excel, PowerPoint, and AI Documents. Shared styles improve navigation, spacing, card hierarchy, visual feedback, contrast, responsive behavior, and reduced-motion handling.

Run the workflow integration checks with:

```powershell
npm run test:workflow
npm run test:workflow-runtime
npm run test:navigation
```

Run the full suite and production build with:

```powershell
npm test
npm run build
npm run preview
```


## Phase 8 — My Workspace / فضای کاری من

- Word, Excel, PowerPoint and extracted AI Documents drafts are autosaved locally in the browser's IndexedDB; `localStorage` is a small fallback only when IndexedDB is unavailable.
- My Workspace lists recent drafts, filters by workspace type, searches names and text previews, opens drafts, deletes individual items, clears all local drafts after confirmation, and displays local storage usage.
- JSON backup export/import is supported. Backup files contain the locally saved text/document data in readable JSON; they are not encrypted. Do not store sensitive documents in this local library unless the device/browser profile is appropriately protected.
- Storage bounds: 40 records, 4 MB per record, 60 MB IndexedDB total, 3.5 MB fallback total, and 25 MB per backup. Large items that exceed a limit show a save/export warning rather than silently claiming success.
- Imported PPTX files now create a distinct local draft and autosave immediately. Exporting DOCX/XLSX/PPTX does not cancel the pending local autosave.
- AI remains deliberately disconnected: the Worker feature status reports disabled and Worker `AI_ENABLED = "false"`. The UI can prepare/extract content locally, but no prompt or document text is sent to an AI provider in this phase.
- Run `npm test` to include `test:workspace`, which checks the local library safeguards, workspace autosave/restore wiring, backup paths and AI-offline guards.

## Local workspace & AI activation policy

- Word, Excel, PowerPoint and extracted document workspaces are autosaved to the browser's IndexedDB. A small localStorage fallback is used only if IndexedDB is unavailable.
- My Workspace can connect a user-selected local folder through the File System Access API on supported browsers. The folder handle remains in the browser's IndexedDB; exports are written into the selected folder and app-owned `.pdat.json` snapshots mirror workspace drafts. Folder access is requested only after the user clicks the connect button. Permission may need to be renewed by the browser.
- If direct folder linking is unavailable, the app uses the device's normal save/download flow. On supported browsers, clearing browser site data removes the stored folder handle; the user can reconnect the same folder and import app snapshots. Disconnecting the folder does not delete files in it.
- Document files and workspace content are not sent to D1 or stored in a server document database. Account details, subscription/payment records and feedback explicitly submitted by users remain server-side for product operations.
- AI modules and prompts remain in the codebase but are intentionally disabled in the frontend feature status and Worker (`AI_ENABLED = "false"`). No AI requests are sent in this release. Do not enable the Worker variable or frontend flag until API credentials, quotas, privacy disclosures and deployment settings are reviewed.


## Phase 9 — Local-first selected device folder / پوشه شخصی روی دستگاه

- My Workspace includes an explicit “Choose and connect folder” action. The native directory picker opens only after the user's click; the user chooses the folder and approves read/write access. The app never searches for or chooses a folder automatically. For privacy, users should create a dedicated `PDF AI Tools` folder rather than selecting an entire Documents/Desktop directory.
- On supported secure-context browsers (HTTPS or localhost), the selected `FileSystemDirectoryHandle` is stored in a separate local IndexedDB database. The handle, folder name and folder contents are not sent to the Worker or D1. Browser permission can expire or be revoked; My Workspace provides a user-click reauthorization action.
- Generated PDF, DOCX, XLSX, PPTX, TXT, ZIP, JSON backup and feedback CSV outputs use the selected folder when read/write permission is granted. Filenames are made unique to avoid overwriting existing user files. If the folder is unavailable or the browser does not support the API, the standard device/browser download flow is used and a notice explains the fallback.
- Local workspace drafts continue to use a bounded IndexedDB/localStorage cache for the fast UI. When folder access is connected, app-owned `pdf-ai-tools-draft-*.pdat.json` snapshots are mirrored into the selected folder; they can be imported after clearing browser data or using the app in the same browser profile again. The folder contains only these app-owned snapshots plus the output files the user explicitly creates.
- Disconnecting the folder removes only the stored folder handle; it does not delete any files in the user's folder. Deleting a local draft removes its matching app snapshot only when permission is granted.
- This is not a guarantee of permanent access on every mobile browser. The File System Access API is limited in availability, requires a secure context and a direct user gesture, and the browser may require renewed permission. On browsers without directory-picker support, regular save/download is the fallback.
- The browser folder handle and local workspace belong to the current browser profile/origin, not to a website login. On a shared computer, use a separate OS account or browser profile per person; the website login alone does not isolate local files. Browser storage and folder snapshots are not encrypted separately by this app.
- No new server-side document database or cloud document upload was added. D1 remains for account, subscription/payment and feedback operations. AI stays disconnected: Worker `AI_ENABLED = "false"` and the public feature status remains disabled.
- Tests added: `test:device-folder`, `test:device-folder-runtime`, `test:device-folder-integration`, and `test:device-folder-privacy`.
- Translation checks: `test:translation` validates OCR/translation wiring and quota migration; `test:translation-runtime` exercises authenticated Worker translation routes, plan quotas, provider failures/refunds, and independent AI feature flags with a local mocked provider.


## Translation feature (separate opt-in)

The dedicated Translator is separately gated from general AI. Keep `AI_ENABLED = "false"` to leave AI Documents and the assistant disabled. Set the Worker variable `TRANSLATION_ENABLED = "true"` only after configuring the existing Anthropic-compatible `AI_API_KEY` secret, `AI_API_URL`, and `AI_MODEL`. The frontend never receives the provider key.

The authenticated `/api/translate` endpoint enforces a separate atomic UTC-day quota in D1: Free 3 requests/day and 3,000 Unicode code points/request; Pro 200 requests/day and 20,000 Unicode code points/request. The migration `worker/migrations/0004_translation_usage.sql` rebuilds the existing daily usage-counter table while preserving AI and agent counts. Apply it exactly once to an existing D1 database before deploying the Worker. Fresh databases created from `worker/schema.sql` already allow the `translate` usage type and do not need this migration.

OCR remains local in the browser. Translation sends only the exact text in the translator input after the user checks the consent box and presses Translate; it never sends the original image or file. Translation output is returned to the browser and is not stored in D1. If the translation flag or provider credentials are absent, the endpoint reports that translation is unavailable and does not fabricate a result.

### Enable translation without enabling general AI

1. Keep `AI_ENABLED = "false"` in `wrangler.toml`; the AI Documents and Agent/Assistant endpoints remain disabled.
2. Configure the Anthropic-compatible provider URL and a currently supported model name in `AI_API_URL` and `AI_MODEL`.
3. Store the provider key as a Worker secret, not in frontend code: `npx wrangler secret put AI_API_KEY`.
4. For an existing D1 database created before this feature, apply the migration once: `npx wrangler d1 execute pdf-ai --file=worker/migrations/0004_translation_usage.sql --remote`.
5. Set only `TRANSLATION_ENABLED = "true"` in the Worker vars and deploy with `npx wrangler deploy`. Leave `AI_ENABLED = "false"` unchanged.
6. Verify `/api/translate` while signed in. Until the flag and secret/model configuration are valid, the UI must report that translation is unavailable.

The frontend never receives the provider key. Every POST requires a signed-in user and per-request checkbox consent; the Worker derives Free/Pro from the server-side subscription, checks input size and supported languages, uses a separate atomic D1 daily counter plus an atomic short-window D1 throttle, and refunds the daily counter when the provider fails or times out. Do not enable translation until the privacy notice and provider terms have been reviewed for your deployment.

## AI Assistant infrastructure (prepared, intentionally disconnected)

- The Assistant UI supports local preparation of PDF, DOCX, XLSX, PPTX, TXT, CSV and TSV source text. The browser extracts and labels source sections locally; only explicitly selected extracted text is part of a future request. Original files are not sent to an AI provider.
- `GET /api/features` is the non-sensitive status source for chat, document analysis and tool calling. The UI fails closed when the Worker is unavailable or reports a feature disabled.
- Prepared authenticated routes are `POST /api/assistant` (conversation), `POST /api/ai` (document tasks) and `POST /api/agent` (controlled tool calling). The Worker is the authoritative gate; all three return `503` while general `AI_ENABLED` is false.
- Tool schemas come from `shared/agent-tool-catalog.ts` on the server. The browser cannot submit its own catalogue. The Worker validates tool names, argument keys and file metadata; the browser revalidates arguments against its local workspace, plan limits and user confirmation hooks before executing only registered local tools. No model-supplied JavaScript, unrestricted filesystem operation or arbitrary network tool is allowed.
- Provider-specific code is isolated in the Worker adapter and currently supports Anthropic Messages and OpenAI-compatible Chat Completions. The frontend only calls the same-origin Worker. API keys belong in Worker secrets, never in frontend files or Wrangler vars.
- `AI_ENABLED=false` and `AGENT_ENABLED=false` remain the shipped defaults. `AI_API_KEY` is not included in source. No AI/Assistant/Agent usage quota is consumed while the Worker feature is disabled. The `ai` counter is for document AI; the `agent` counter is shared by Assistant/Agent; `translate` remains its own independent counter and feature flag.
- No complete conversation or source-document content is stored in D1. D1 usage counters contain only account identifier, UTC day, usage type and count. The API contract, environment variables, tests and future activation/rollback checklist are documented in `Documentation/AI/API-INTEGRATION-GUIDE.md`.
- Tests that do not require a live AI provider are included in `npm test`: `test:assistant` and `test:assistant-runtime`. The Worker runtime test explicitly counts outbound provider requests and asserts zero while general AI features are disabled.

Do not activate the Assistant or Agent until the project owner explicitly approves provider selection, credentials, privacy disclosure, cost limits, quota settings and a staged production rollout. Enabling the Translator separately does not enable general AI.


## Phase 5 — Security and privacy hardening

- The Worker uses exact-origin CORS based on `APP_URL`, route-specific HTTP methods, request-body byte limits, standard security headers, HMAC-keyed D1 rate-limit buckets and server-side user ownership checks. No wildcard credentialed CORS is enabled.
- Sign-in challenges store only a keyed email identifier and a code hash in D1, expire after 10 minutes and are consumed using a single atomic `DELETE ... RETURNING`. Logout revokes the current bearer token in D1 until its normal expiry.
- Apply D1 migrations `0005_security_hardening.sql` and `0006_auth_challenges.sql` to a development database first, then to the intended environment before deploying the Worker. The Wrangler D1 binding points at `worker/migrations`; check applied migration history before applying anything.
- PDF and image uploads are checked against extension/MIME agreement and file signatures before local processing. ZIP-based Office imports are inspected before expansion for entry count, expanded-size limits, path traversal, encryption, ZIP64, duplicate paths and inconsistent local/central headers. Files continue to be processed locally.
- `AI_ENABLED = "false"`, `AGENT_ENABLED = "false"` and `TRANSLATION_ENABLED = "false"` remain the configured defaults. Do not enable them as part of a security deployment.
- Cloudflare Pages deployments must serve `public/_headers` so the CSP and static security headers take effect. The CSP permits jsDelivr for the existing Tesseract.js worker/core runtime; OCR remains local to the browser, but the browser may fetch worker/core/language assets from the configured CDN. Use `VITE_TESSDATA_URL` for self-hosted language data and adjust CSP only for the exact trusted asset origin if the deployment changes.
- See [`Documentation/Security/PHASE-5-SECURITY-REPORT.md`](Documentation/Security/PHASE-5-SECURITY-REPORT.md) and [`Documentation/Security/SECURITY-CONFIGURATION-GUIDE.md`](Documentation/Security/SECURITY-CONFIGURATION-GUIDE.md).
## Security (Phase 5)

See [`Documentation/Security/PHASE-5-SECURITY-REPORT.md`](Documentation/Security/PHASE-5-SECURITY-REPORT.md) for the current source audit, verified fixes, test results and open deployment checks. Use [`Documentation/Security/SECURITY-CONFIGURATION-GUIDE.md`](Documentation/Security/SECURITY-CONFIGURATION-GUIDE.md) for Worker secrets, D1 migrations and deployment hardening. AI and Agent integrations remain disabled.

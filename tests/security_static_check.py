from pathlib import Path
import json
import re

ROOT = Path(__file__).resolve().parents[1]
worker = (ROOT / "worker/index.ts").read_text(encoding="utf-8")
wrangler = (ROOT / "wrangler.toml").read_text(encoding="utf-8")
headers = (ROOT / "public/_headers").read_text(encoding="utf-8")
privacy = (ROOT / "src/ui/Legal.tsx").read_text(encoding="utf-8")
package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))

assert '"preview": "vite preview"' in (ROOT / "package.json").read_text(encoding="utf-8")
assert package["dependencies"]["fflate"] == "^0.8.3", "use ZIP parser release with malformed ZIP64 DoS fix"
assert package["dependencies"]["pdfjs-dist"] == "^4.2.67", "use PDF.js 4.x security-patched release"
assert package["devDependencies"]["vite"] == "^6.4.6", "use Vite 6 security-patched release"
assert package["devDependencies"]["@vitejs/plugin-react"] == "^4.3.4", "plugin-react must support Vite 6"
assert "server: { proxy:" in (ROOT / "vite.config.ts").read_text(encoding="utf-8")
assert not re.search(r"server\s*:\s*\{[^}]*host\s*:", (ROOT / "vite.config.ts").read_text(encoding="utf-8"), re.S), "do not expose Vite dev server on all network interfaces by default"
assert 'migrations_dir = "worker/migrations"' in wrangler
assert 'AI_ENABLED = "false"' in wrangler and 'AGENT_ENABLED = "false"' in wrangler
assert 'TRANSLATION_ENABLED = "false"' in wrangler
assert 'Access-Control-Allow-Origin", allowed' in worker
assert 'Access-Control-Allow-Credentials' not in worker
assert 'Access-Control-Allow-Origin", "*"' not in worker
assert 'WHERE id = ?' in worker and 'payload.uid' in worker
assert 'revoked_tokens' in worker and 'INSERT OR REPLACE INTO revoked_tokens' in worker
assert 'DELETE FROM auth_challenges WHERE email_hash = ? AND code_hash = ? AND expires_at > ? RETURNING' in worker
assert 'bumpAtomic(env, `auth-verify:ip:' in worker
assert 'bumpAtomic(env, `auth-verify:email:' in worker
assert worker.index('bumpAtomic(env, `auth-request:ip:') < worker.index('https://challenges.cloudflare.com/turnstile/v0/siteverify'), 'local auth rate limiting must precede external CAPTCHA verification'
assert 'readRequestText(req, 500_000)' in worker
assert 'redirect: "error"' in worker
assert "frame-ancestors 'none'" in headers and "object-src 'none'" in headers
assert "script-src 'self'" in headers and "'unsafe-inline'" not in headers.split("script-src", 1)[1].split(";", 1)[0]
assert "https://cdn.jsdelivr.net" in headers, "Tesseract.js worker/core CDN must not be blocked by CSP"
assert 'self-service or automatic account deletion' in privacy or 'حذف خودکار' in privacy
assert '.dev.vars' in (ROOT / ".gitignore").read_text(encoding="utf-8")

for secret_file in (".env", ".dev.vars"):
    assert not (ROOT / secret_file).exists(), f"unexpected local secret file: {secret_file}"

# The worker SQL uses bound parameters for its dynamic values; no interpolated user SQL is allowed.
assert not re.search(r"prepare\(\s*`[^`]*\$\{", worker, re.S), "dynamic values must not be interpolated into SQL"

print("PASS: security configuration, AI-off flags, CORS, request bounds, migration path, secret-file hygiene and privacy wording")

assert 'await hmac(`${email}:${code}`, env.JWT_SECRET)' in worker, "OTP code digest must be keyed against offline DB-only brute force"
assert 'redirect: "error"' in worker[worker.index('async function authRequest'):worker.index('async function authVerify')], "sign-in email API must not follow redirects"
pdf_editor = (ROOT / "src/ui/PDFEditor.tsx").read_text(encoding="utf-8")
scan_center = (ROOT / "src/ui/ScanCenter.tsx").read_text(encoding="utf-8")
assert 'hasExpectedFileSignature(file, expectedMime)' in pdf_editor
assert 'hasExpectedFileSignature(file, expectedMime)' in scan_center
for source_path in (ROOT / "src").rglob("*.ts"):
    if source_path.name.endswith(".d.ts"):
        continue
    source_text = source_path.read_text(encoding="utf-8")
    if "pdfjs.getDocument(" in source_text:
        for match in re.finditer(r"pdfjs\.getDocument\(\{([^}]*)\}\)", source_text, re.S):
            assert 'isEvalSupported: false' in match.group(1), f"PDF.js eval disabled for untrusted documents: {source_path}"

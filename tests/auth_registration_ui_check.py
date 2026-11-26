from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
app = (ROOT / "src/ui/App.tsx").read_text(encoding="utf-8")
account = (ROOT / "src/ui/Account.tsx").read_text(encoding="utf-8")
i18n = (ROOT / "src/core/i18n.ts").read_text(encoding="utf-8")
worker = (ROOT / "worker/index.ts").read_text(encoding="utf-8")
schema = (ROOT / "worker/schema.sql").read_text(encoding="utf-8")
app_js = (ROOT / "src/ui/App.js").read_text(encoding="utf-8")
account_js = (ROOT / "src/ui/Account.js").read_text(encoding="utf-8")
i18n_js = (ROOT / "src/core/i18n.js").read_text(encoding="utf-8")

assert 'openAuth("register")' in app
assert 'openAuth("login")' in app
assert 'mode={authMode}' in app
assert 'onModeChange={setAuthMode}' in app
assert 't("createAccount")' in app
assert 'mode === "register" ? "/api/auth/register" : "/api/auth/login"' in account
assert 'name="confirm-password"' in account
assert 'password' in account and 'confirmPassword' in account
assert 'sendCode' not in account and 'one-time-code' not in account
assert 'Create account' in app_js or 'createAccount' in app_js
assert '/api/auth/register' in account_js and '/api/auth/login' in account_js
assert 'emailVerificationWarning' in app and 'emailUnverifiedAfterDay' in i18n
assert 'emailVerificationWarning' in app_js and 'emailUnverifiedAfterDay' in i18n_js
assert 'pbkdf2-sha256' in worker and 'PBKDF2' in worker
assert 'email_verified_at' in schema and 'password_hash' in schema
assert 'authVerificationNote:' in i18n
assert 'legacy_account_not_available' in worker
print("PASS: email/password signup and login, no OTP in new-user UI, bilingual content, and legacy-account compatibility")

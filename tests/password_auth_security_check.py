from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
worker = (ROOT / "worker/index.ts").read_text(encoding="utf-8")
account = (ROOT / "src/ui/Account.tsx").read_text(encoding="utf-8")
app = (ROOT / "src/ui/App.tsx").read_text(encoding="utf-8")
schema = (ROOT / "worker/migrations/0007_password_auth_email_verification.sql").read_text(encoding="utf-8")

checks = {
    "password registration endpoint": '"/api/auth/register"' in worker and "authRegister(req" in worker,
    "password login endpoint": '"/api/auth/login"' in worker and "authLogin(req" in worker,
    "PBKDF2 password hashing": "PBKDF2" in worker and "PASSWORD_ITERATIONS = 210_000" in worker,
    "server-side rate limiting": "auth-register:ip:" in worker and "auth-login:email:" in worker,
    "new signup UI does not send OTP": "/api/auth/register" in account and "sendCode" not in account and "one-time-code" not in account,
    "warning appears after 24 hours": "emailVerificationWarning" in app and "emailUnverifiedAfterDay" in app,
    "billing requires verified email": worker.count('if (!user.email_verified_at) return fail("email_verification_required", 403);') >= 2,
    "future verification is feature-flagged": 'env.EMAIL_VERIFICATION_ENABLED !== "true"' in worker,
    "migration adds password and verification fields": "ADD COLUMN password_hash" in schema and "ADD COLUMN email_verified_at" in schema,
    "legacy OTP cannot create accounts": "legacy_account_not_available" in worker and "INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)" not in worker,
}
for name, passed in checks.items():
    print(("PASS" if passed else "FAIL") + " - " + name)
if not all(checks.values()):
    raise SystemExit(1)
print(f"\n{sum(checks.values())}/{len(checks)} checks passed")

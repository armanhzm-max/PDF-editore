from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
migration = (ROOT / "worker/migrations/0007_password_auth_email_verification.sql").read_text(encoding="utf-8")
connection = sqlite3.connect(":memory:")
connection.execute("CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, plan_until INTEGER NOT NULL DEFAULT 0, stripe_customer TEXT, stripe_subscription TEXT, stripe_plan_until INTEGER NOT NULL DEFAULT 0, zarinpal_plan_until INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)")
connection.execute("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)", ("legacy-1", "legacy@example.com", 1700000000))
connection.executescript(migration)
columns = {row[1] for row in connection.execute("PRAGMA table_info(users)").fetchall()}
assert "password_hash" in columns
assert "email_verified_at" in columns
legacy = connection.execute("SELECT password_hash, email_verified_at, created_at FROM users WHERE id = 'legacy-1'").fetchone()
assert legacy[0] is None and legacy[1] == legacy[2] == 1700000000
connection.execute("INSERT INTO users (id, email, password_hash, email_verified_at, created_at) VALUES (?, ?, ?, NULL, ?)", ("new-1", "new@example.com", "pbkdf2-hash", 1800000000))
new_user = connection.execute("SELECT email_verified_at FROM users WHERE id = 'new-1'").fetchone()
assert new_user[0] is None
print("PASS: migration preserves old OTP-verified accounts and leaves new accounts unverified")

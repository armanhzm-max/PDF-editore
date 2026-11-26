from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
connection = sqlite3.connect(":memory:")
connection.executescript((ROOT / "worker" / "schema.sql").read_text(encoding="utf-8"))
connection.execute(
    "INSERT INTO users (id, email, plan_until, stripe_customer, stripe_subscription, stripe_plan_until, zarinpal_plan_until, created_at) VALUES (?, ?, 0, ?, ?, 0, 0, 1)",
    ("user-1", "test@example.com", "cus_test", "sub_test"),
)

# Daily quota: allows the configured count, then rejects further increments.
for expected in (1, 2, 3):
    row = connection.execute("""
        INSERT INTO usage_counters (user_id, usage_day, usage_type, count)
        VALUES ('user-1', '2026-11-21', 'ai', 1)
        ON CONFLICT(user_id, usage_day, usage_type)
        DO UPDATE SET count = count + 1
        WHERE usage_counters.count < 3
        RETURNING count
    """).fetchone()
    assert row == (expected,), (row, expected)
row = connection.execute("""
    INSERT INTO usage_counters (user_id, usage_day, usage_type, count)
    VALUES ('user-1', '2026-11-21', 'ai', 1)
    ON CONFLICT(user_id, usage_day, usage_type)
    DO UPDATE SET count = count + 1
    WHERE usage_counters.count < 3
    RETURNING count
""").fetchone()
assert row is None, row

# Zarinpal: marking one authority paid and granting its pass is idempotent.
connection.execute("INSERT INTO zarinpal_payments (authority, user_id, amount, status, created_at) VALUES ('A-test', 'user-1', 500000, 'pending', 1)")
now, thirty_days = 1000, 30 * 86400
for _ in range(2):
    connection.execute("UPDATE zarinpal_payments SET status='paid', paid_at=? WHERE authority='A-test' AND status='pending'", (now,))
    connection.execute("""
        UPDATE users
        SET zarinpal_plan_until = MAX(zarinpal_plan_until, stripe_plan_until, ?) + ?,
            plan_until = MAX(zarinpal_plan_until, stripe_plan_until, ?) + ?
        WHERE id=(SELECT user_id FROM zarinpal_payments WHERE authority='A-test' AND status='paid')
        AND changes() = 1
    """, (now, thirty_days, now, thirty_days))
assert connection.execute("SELECT plan_until FROM users WHERE id='user-1'").fetchone()[0] == now + thirty_days

# Renewing/cancelling Stripe must not erase a separate unexpired Zarinpal pass.
connection.execute("UPDATE users SET stripe_plan_until=2000, plan_until=MAX(zarinpal_plan_until, 2000) WHERE id='user-1'")
connection.execute("UPDATE users SET stripe_plan_until=?, plan_until=MAX(zarinpal_plan_until, ?) WHERE id='user-1'", (now, now))
assert connection.execute("SELECT plan_until FROM users WHERE id='user-1'").fetchone()[0] == now + thirty_days

# Stripe: a duplicate event ID cannot reapply an entitlement update or erase Zarinpal access.
for period_end in (5000, 9000):
    connection.execute("INSERT OR IGNORE INTO processed_webhook_events (event_id, event_type, processed_at) VALUES ('evt_once', 'customer.subscription.updated', ?)", (now,))
    connection.execute("UPDATE users SET stripe_plan_until=?, plan_until=MAX(zarinpal_plan_until, ?) WHERE stripe_subscription='sub_test' AND changes()=1", (period_end, period_end))
stripe_until, aggregate_until = connection.execute("SELECT stripe_plan_until, plan_until FROM users WHERE id='user-1'").fetchone()
assert stripe_until == 5000, stripe_until
assert aggregate_until == now + thirty_days, aggregate_until

print("PASS: schema creation, atomic daily quota, one-time Zarinpal grant, Stripe event deduplication")

# Existing accounts: the one-time migration must preserve their current access date.
legacy = sqlite3.connect(":memory:")
legacy.executescript("""
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      plan_until INTEGER NOT NULL DEFAULT 0,
      stripe_customer TEXT,
      created_at INTEGER NOT NULL
    );
    INSERT INTO users (id, email, plan_until, stripe_customer, created_at)
      VALUES ('legacy-stripe', 'stripe@example.com', 7000, 'cus_legacy', 1);
    INSERT INTO users (id, email, plan_until, stripe_customer, created_at)
      VALUES ('legacy-zp', 'zarin@example.com', 8000, NULL, 1);
""")
legacy.executescript((ROOT / "worker" / "migrations" / "0002_stripe_subscription.sql").read_text(encoding="utf-8"))
legacy.executescript((ROOT / "worker" / "schema.sql").read_text(encoding="utf-8"))
assert legacy.execute("SELECT stripe_plan_until, zarinpal_plan_until FROM users WHERE id='legacy-stripe'").fetchone() == (7000, 0)
assert legacy.execute("SELECT stripe_plan_until, zarinpal_plan_until FROM users WHERE id='legacy-zp'").fetchone() == (0, 8000)

# The first subscription webhook can associate an old migrated account by customer ID.
legacy.execute("INSERT OR IGNORE INTO processed_webhook_events (event_id, event_type, processed_at) VALUES ('evt_legacy', 'customer.subscription.updated', 9000)")
legacy.execute("""
    UPDATE users
    SET stripe_plan_until = ?, plan_until = MAX(zarinpal_plan_until, ?), stripe_subscription = ?
    WHERE (stripe_subscription = ? OR (stripe_subscription IS NULL AND stripe_customer = ?))
      AND changes() = 1
""", (12000, 12000, "sub_legacy", "sub_legacy", "cus_legacy"))
assert legacy.execute("SELECT stripe_subscription, stripe_plan_until FROM users WHERE id='legacy-stripe'").fetchone() == ("sub_legacy", 12000)

print("PASS: legacy-account migration and Stripe subscription recovery")

# Feedback accepts well-formed reports, enforces field constraints, and stores no IP column.
connection.execute("INSERT INTO feedback_submissions (id, category, rating, message, contact, locale, page_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    ("feedback-1", "bug", 4, "The rotate action does not update the preview", None, "en", "/#editor", 1000))
assert connection.execute("SELECT category, rating FROM feedback_submissions WHERE id='feedback-1'").fetchone() == ("bug", 4)
try:
    connection.execute("INSERT INTO feedback_submissions (id, category, rating, message, created_at) VALUES ('bad-category', 'spam', 3, 'This is a valid-length message', 1000)")
    raise AssertionError("invalid feedback category was accepted")
except sqlite3.IntegrityError:
    pass
try:
    connection.execute("INSERT INTO feedback_submissions (id, category, rating, message, created_at) VALUES ('bad-rating', 'other', 8, 'This is a valid-length message', 1000)")
    raise AssertionError("invalid feedback rating was accepted")
except sqlite3.IntegrityError:
    pass
columns = {row[1] for row in connection.execute("PRAGMA table_info(feedback_submissions)")}
assert "ip_address" not in columns and "raw_ip" not in columns
print("PASS: feedback constraints and no raw IP column")


# An already-stabilized database without the newly-added feedback table can apply migration 0003.
pre_feedback = sqlite3.connect(":memory:")
canonical_schema = (ROOT / "worker" / "schema.sql").read_text(encoding="utf-8")
pre_feedback.executescript(canonical_schema.split("-- Anonymous product feedback", 1)[0])
pre_feedback.executescript((ROOT / "worker" / "migrations" / "0003_feedback.sql").read_text(encoding="utf-8"))
assert pre_feedback.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='feedback_submissions'").fetchone()
print("PASS: feedback migration upgrades a pre-feedback stabilized schema")


# Atomic fixed-window abuse controls never require raw email/IP values.
rate_key = "hmac-test-bucket"
window_start = 10_000
for expected in (1, 2, 3):
    rate_row = connection.execute("""
      INSERT INTO security_rate_limits (bucket_key, window_start, count, expires_at)
      VALUES (?, ?, 1, ?)
      ON CONFLICT(bucket_key) DO UPDATE SET
        window_start = excluded.window_start,
        count = CASE WHEN security_rate_limits.window_start = excluded.window_start THEN security_rate_limits.count + 1 ELSE 1 END,
        expires_at = excluded.expires_at
      WHERE security_rate_limits.window_start <> excluded.window_start OR security_rate_limits.count < ?
      RETURNING count
    """, (rate_key, window_start, window_start + 60, 3)).fetchone()
    assert rate_row == (expected,), rate_row
blocked = connection.execute("""
  INSERT INTO security_rate_limits (bucket_key, window_start, count, expires_at) VALUES (?, ?, 1, ?)
  ON CONFLICT(bucket_key) DO UPDATE SET window_start=excluded.window_start,
  count=CASE WHEN security_rate_limits.window_start=excluded.window_start THEN security_rate_limits.count+1 ELSE 1 END,
  expires_at=excluded.expires_at
  WHERE security_rate_limits.window_start <> excluded.window_start OR security_rate_limits.count < ?
  RETURNING count
""", (rate_key, window_start, window_start + 60, 3)).fetchone()
assert blocked is None, blocked
reset = connection.execute("""
  INSERT INTO security_rate_limits (bucket_key, window_start, count, expires_at) VALUES (?, ?, 1, ?)
  ON CONFLICT(bucket_key) DO UPDATE SET window_start=excluded.window_start,
  count=CASE WHEN security_rate_limits.window_start=excluded.window_start THEN security_rate_limits.count+1 ELSE 1 END,
  expires_at=excluded.expires_at
  WHERE security_rate_limits.window_start <> excluded.window_start OR security_rate_limits.count < ?
  RETURNING count
""", (rate_key, window_start + 60, window_start + 120, 3)).fetchone()
assert reset == (1,), reset

# OTP challenge is short-lived and a successful code consumes it exactly once.
connection.execute("INSERT OR REPLACE INTO auth_challenges (email_hash, code_hash, expires_at) VALUES (?, ?, ?)", ("email-hmac", "code-sha", 50_000))
consumed = connection.execute("DELETE FROM auth_challenges WHERE email_hash=? AND code_hash=? AND expires_at>? RETURNING email_hash", ("email-hmac", "code-sha", 49_999)).fetchone()
assert consumed == ("email-hmac",), consumed
second_consume = connection.execute("DELETE FROM auth_challenges WHERE email_hash=? AND code_hash=? AND expires_at>? RETURNING email_hash", ("email-hmac", "code-sha", 49_999)).fetchone()
assert second_consume is None, second_consume
connection.execute("INSERT INTO auth_challenges (email_hash, code_hash, expires_at) VALUES (?, ?, ?)", ("expired-hmac", "old-code", 10))
expired_consume = connection.execute("DELETE FROM auth_challenges WHERE email_hash=? AND code_hash=? AND expires_at>? RETURNING email_hash", ("expired-hmac", "old-code", 11)).fetchone()
assert expired_consume is None, expired_consume
print("PASS: atomic D1 rate limits, fixed-window reset, one-time OTP consumption and expiry")

# New security migrations upgrade a pre-hardening database without changing existing account data.
upgrade = sqlite3.connect(":memory:")
pre_security_schema = canonical_schema.split("-- Short-lived abuse-control buckets", 1)[0]
upgrade.executescript(pre_security_schema)
upgrade.execute("INSERT INTO users (id, email, plan_until, created_at) VALUES (?, ?, ?, ?)",
                 ("phase5-existing-user", "existing@example.test", 123456, 1))
upgrade.executescript((ROOT / "worker" / "migrations" / "0005_security_hardening.sql").read_text(encoding="utf-8"))
upgrade.executescript((ROOT / "worker" / "migrations" / "0006_auth_challenges.sql").read_text(encoding="utf-8"))
assert upgrade.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='security_rate_limits'").fetchone()
assert upgrade.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='revoked_tokens'").fetchone()
assert upgrade.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='auth_challenges'").fetchone()
assert upgrade.execute("SELECT email, plan_until FROM users WHERE id='phase5-existing-user'").fetchone() == ("existing@example.test", 123456)
print("PASS: additive migrations 0005/0006 preserve existing accounts and add security tables")

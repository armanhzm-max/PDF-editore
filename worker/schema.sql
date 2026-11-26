CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  plan_until INTEGER NOT NULL DEFAULT 0,
  stripe_customer TEXT,
  stripe_subscription TEXT,
  stripe_plan_until INTEGER NOT NULL DEFAULT 0,
  zarinpal_plan_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  password_hash TEXT,
  email_verified_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_stripe ON users(stripe_customer);
CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users(stripe_subscription);

-- Atomic per-account daily quotas for AI, assistant, and translation requests.
CREATE TABLE IF NOT EXISTS usage_counters (
  user_id TEXT NOT NULL,
  usage_day TEXT NOT NULL,
  usage_type TEXT NOT NULL CHECK (usage_type IN ('ai', 'agent', 'translate')),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (user_id, usage_day, usage_type)
);
CREATE INDEX IF NOT EXISTS idx_usage_counters_day ON usage_counters(usage_day);

-- Stripe event IDs prevent retries from granting the same entitlement twice.
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);

-- A single authority maps to one locally recorded 30-day payment intent.
CREATE TABLE IF NOT EXISTS zarinpal_payments (
  authority TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid')),
  created_at INTEGER NOT NULL,
  paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_zarinpal_user ON zarinpal_payments(user_id);
CREATE INDEX IF NOT EXISTS idx_zarinpal_status_created ON zarinpal_payments(status, created_at);


-- Anonymous product feedback; no raw IP address or uploaded documents are stored.
CREATE TABLE IF NOT EXISTS feedback_submissions (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('bug', 'feature', 'usability', 'other')),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 10 AND 3000),
  contact TEXT,
  locale TEXT,
  page_path TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedback_category_created ON feedback_submissions(category, created_at DESC);

-- Short-lived abuse-control buckets store only HMACed identifiers, never raw IP/email values.
CREATE TABLE IF NOT EXISTS security_rate_limits (
  bucket_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK (count >= 0),
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_security_rate_limits_expiry ON security_rate_limits(expires_at);

-- Revocation records make sign-out effective for a stolen bearer token until its natural expiry.
CREATE TABLE IF NOT EXISTS revoked_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revoked_tokens_expiry ON revoked_tokens(expires_at);


-- Single-use, short-lived OTP challenges. Email identifiers and code values are never stored in plaintext; code hashes are keyed HMACs.
CREATE TABLE IF NOT EXISTS auth_challenges (
  email_hash TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expiry ON auth_challenges(expires_at);

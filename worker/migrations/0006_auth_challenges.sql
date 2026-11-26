-- Short-lived, single-use OTP challenges. Store only HMACed email identifiers and HMACed code hashes.
CREATE TABLE IF NOT EXISTS auth_challenges (
  email_hash TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_challenges_expiry ON auth_challenges(expires_at);

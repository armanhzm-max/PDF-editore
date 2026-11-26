-- Password-based sign-in with explicit, initially-unverified email status.
-- Existing accounts were created only after the previous email OTP was verified,
-- so preserve that verified status during migration. New accounts leave it NULL.
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL;

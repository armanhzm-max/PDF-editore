-- Run exactly once on databases created with the original users schema.
ALTER TABLE users ADD COLUMN stripe_subscription TEXT;
ALTER TABLE users ADD COLUMN stripe_plan_until INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN zarinpal_plan_until INTEGER NOT NULL DEFAULT 0;

-- Preserve the existing aggregate expiry as the appropriate provider-specific expiry.
UPDATE users
SET stripe_plan_until = CASE WHEN stripe_customer IS NOT NULL THEN plan_until ELSE 0 END,
    zarinpal_plan_until = CASE WHEN stripe_customer IS NULL THEN plan_until ELSE 0 END;

CREATE INDEX IF NOT EXISTS idx_users_stripe_subscription ON users(stripe_subscription);

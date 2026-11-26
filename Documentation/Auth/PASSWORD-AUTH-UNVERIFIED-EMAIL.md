# Password Sign-up with Deferred Email Verification

## Current behavior
- New users register with an email address and a password; no email code is sent during registration or login.
- Passwords are stored as salted PBKDF2-SHA-256 hashes (210,000 iterations); plaintext passwords are never stored.
- Minimum password length is 12 characters; maximum is 128. Login and registration are rate-limited server-side.
- New accounts are marked as email-unverified. Normal local tools and the signed-in translation workflow remain available.
- A reminder is shown after 24 hours if the email is still unverified. The reminder does not lock ordinary tools.
- Subscription checkout and billing portal access are denied server-side until email ownership is verified. This is enforced regardless of the age of the account.
- Password reset is intentionally unavailable while email verification is disabled. Users must retain their password.

## Later activation of verification
Email verification is disabled unless the Worker environment variable `EMAIL_VERIFICATION_ENABLED` is set to `true`. When the flag is enabled and `RESEND_API_KEY` and `MAIL_FROM` are configured, the reminder exposes a verification-code flow. No email is sent while the flag is false.

## Cloudflare D1 migration
Apply `worker/migrations/0007_password_auth_email_verification.sql` after the existing migrations, including `0006_auth_challenges.sql`. Existing users are marked verified because the former account creation flow only created records after successful email-code verification. Existing signed-in legacy accounts without a password can set one using the account migration panel; old sessions must still be valid.

## Important limitations
Without verification, an email address is only a login identifier and is not proof of ownership. Do not use it as a trusted contact address, send sensitive account recovery links to it, issue invoices or start subscription checkout. A person can register an address they do not control; the application therefore blocks actions that rely on email ownership.

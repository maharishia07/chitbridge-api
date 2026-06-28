-- migration_otp_attempts.sql — per-account OTP attempt counter (defense-in-depth on top of the auth rate limiter).
-- The column is already referenced in code (actors.js / catalogue.js / entities.js) but had no migration — this
-- makes it deterministic for dev/prod. Idempotent and additive; safe on existing rows.
ALTER TABLE identities ADD COLUMN IF NOT EXISTS otp_attempts INT NOT NULL DEFAULT 0;

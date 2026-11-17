-- migration_customer_contact.sql — F2 (dual-channel customer OTP).
-- Stores the customer's REAL OTP delivery target (raw phone OR raw email), separate from the per-entity
-- `.cr` handle kept in identities.email. The channel is derived by sniffing '@' in otp_contact.
-- Additive, nullable, idempotent — safe to re-run and safe on existing rows.
ALTER TABLE identities ADD COLUMN IF NOT EXISTS otp_contact TEXT;

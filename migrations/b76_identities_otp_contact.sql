-- b76: add the OTP columns the B3.7 customer-order flow needs on `identities`. The public storefront order
-- (routes/catalogue.js order/start + order/confirm) INSERTs/UPDATEs `otp_contact` (the raw phone/email to deliver
-- the code to) and `otp_attempts` (the attempt cap). These were referenced in code but never migrated in, so the
-- customer order flow 500s ("column otp_contact of relation identities does not exist"). All additive, IF NOT EXISTS
-- — safe to run once, safe if partially present. No RLS change (identities is not entity-RLS-scoped here).

ALTER TABLE identities ADD COLUMN IF NOT EXISTS otp_contact    text;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS otp_attempts   integer NOT NULL DEFAULT 0;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS otp_code       text;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS otp_expires_at timestamptz;

-- Rollback (optional): the columns are additive; leaving them is harmless.
-- ALTER TABLE identities DROP COLUMN IF EXISTS otp_contact;

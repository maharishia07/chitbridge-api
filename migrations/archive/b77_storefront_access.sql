-- b77: storefront access mode on `identities`. 'browse' (default) = customers browse the public catalogue then
-- order (OTP at checkout); 'login' = the storefront asks the customer to sign in (phone/email + OTP) before browsing.
-- Additive, IF NOT EXISTS, safe. No RLS change.

ALTER TABLE identities ADD COLUMN IF NOT EXISTS storefront_access text NOT NULL DEFAULT 'browse';

-- Rollback (optional): ALTER TABLE identities DROP COLUMN IF EXISTS storefront_access;

-- B3.9 — shop identity / trust display fields (DISPLAY ONLY; real verification deferred)
ALTER TABLE identities ADD COLUMN IF NOT EXISTS gstn        VARCHAR(15);
ALTER TABLE identities ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS logo_url    TEXT;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS address     TEXT;

SELECT 'verified shops' AS t, COUNT(*) FROM identities WHERE is_verified = true;

-- B3.11 — shop business status (open | closed | away). From PHP business_status.
-- Customer-facing "open sign", separate from account status + catalogue visibility.
ALTER TABLE identities ADD COLUMN IF NOT EXISTS business_status VARCHAR(10) NOT NULL DEFAULT 'open';
ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_business_status_chk;
ALTER TABLE identities ADD CONSTRAINT identities_business_status_chk
  CHECK (business_status IN ('open','closed','away'));

SELECT business_status, COUNT(*) FROM identities WHERE identity_type='entity' GROUP BY business_status;

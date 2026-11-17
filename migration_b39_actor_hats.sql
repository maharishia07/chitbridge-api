-- B3.9 Migration — Actor "hats" (engagement) · Decision D2
-- One hat per actor. Assignable = act, manager. Existing actors default to 'act' (assignable) so nothing breaks
-- before hats are set. Apply BEFORE deploying the matching actors.js / chits.js changes.

ALTER TABLE identities ADD COLUMN IF NOT EXISTS hat VARCHAR(16) NOT NULL DEFAULT 'act'
  CHECK (hat IN ('view_only','act','audit','mis','manager'));

-- (hat is only meaningful for identity_type='actor'; entities keep the harmless default.)

-- Verify
SELECT 'identities.hat' AS t,
       string_agg(DISTINCT hat, ', ') AS values
FROM identities WHERE identity_type = 'actor';

-- B3.10 — targeted + erasure-aware disputes
ALTER TABLE chit_disputes ADD COLUMN IF NOT EXISTS target_entity_id    UUID REFERENCES identities(identity_id);
ALTER TABLE chit_disputes ADD COLUMN IF NOT EXISTS target_display_name VARCHAR(200);
ALTER TABLE chit_disputes ADD COLUMN IF NOT EXISTS scope        VARCHAR(20)  NOT NULL DEFAULT 'targeted';
ALTER TABLE chit_disputes ADD COLUMN IF NOT EXISTS mode         VARCHAR(20)  NOT NULL DEFAULT 'two_sided';
ALTER TABLE chit_disputes ADD COLUMN IF NOT EXISTS answerable   BOOLEAN      NOT NULL DEFAULT TRUE;
ALTER TABLE chit_disputes ADD COLUMN IF NOT EXISTS parity_state VARCHAR(20);
ALTER TABLE chit_disputes ADD COLUMN IF NOT EXISTS via          VARCHAR(20)  NOT NULL DEFAULT 'chit';
ALTER TABLE chit_disputes ADD COLUMN IF NOT EXISTS evidence_snapshot JSONB;

DO $$ BEGIN ALTER TABLE chit_disputes ADD CONSTRAINT chk_disp_scope  CHECK (scope IN ('targeted','chit_wide'));     EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE chit_disputes ADD CONSTRAINT chk_disp_mode   CHECK (mode  IN ('two_sided','one_sided'));    EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE chit_disputes ADD CONSTRAINT chk_disp_via    CHECK (via   IN ('chit','mailbox'));           EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE chit_disputes ADD CONSTRAINT chk_disp_parity CHECK (parity_state IS NULL OR parity_state IN ('present','archived','erased','defunct','absent')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- legacy rows kept their old "everyone sees it" behaviour
UPDATE chit_disputes SET scope='chit_wide' WHERE target_entity_id IS NULL AND scope='targeted';

-- erasure / tombstone markers
ALTER TABLE identities ADD COLUMN IF NOT EXISTS is_erased BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS erased_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chit_disputes_target ON chit_disputes(target_entity_id, status);

SELECT 'b310 ready' AS status, COUNT(*) FILTER (WHERE scope='chit_wide') AS legacy_chit_wide FROM chit_disputes;

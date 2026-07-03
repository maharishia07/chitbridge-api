-- B4.1 Migration — Multi-party disputes + dispute-tagged messages · Decision D4
-- A dispute can involve 2+ selected parties (the raiser picks them). Each involved party carries its own
-- dispute_status. Dispute-tagged messages stay filterable even after the dispute closes.
-- Additive: the existing single-target (chit_disputes.target_entity_id) path keeps working.

-- who is involved in a dispute + their per-party status
CREATE TABLE IF NOT EXISTS dispute_participants (
  dispute_id      UUID NOT NULL REFERENCES chit_disputes(dispute_id) ON DELETE CASCADE,
  chit_id         UUID NOT NULL,
  entity_id       UUID NOT NULL,
  display_name    TEXT,
  role            VARCHAR(12) NOT NULL DEFAULT 'party'   CHECK (role IN ('raiser','party')),
  dispute_status  VARCHAR(16) NOT NULL DEFAULT 'open'    CHECK (dispute_status IN ('open','acknowledged','resolved')),
  added_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (dispute_id, entity_id)
);
CREATE INDEX IF NOT EXISTS idx_dispute_participants_entity ON dispute_participants(entity_id, dispute_status);
CREATE INDEX IF NOT EXISTS idx_dispute_participants_chit   ON dispute_participants(chit_id);

-- dispute-related messages — a flag (+ optional link) so a thread can be filtered to dispute traffic,
-- and that filter survives after the dispute is resolved.
ALTER TABLE chit_messages ADD COLUMN IF NOT EXISTS is_dispute BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE chit_messages ADD COLUMN IF NOT EXISTS dispute_id UUID;

-- Verify
SELECT 'dispute_participants' AS t, string_agg(column_name, ', ' ORDER BY ordinal_position) AS cols
FROM information_schema.columns WHERE table_name = 'dispute_participants'
UNION ALL
SELECT 'chit_messages(new)', 'is_dispute, dispute_id';

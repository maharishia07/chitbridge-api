-- B3.5 Migration SQL
-- Run this in Supabase SQL editor BEFORE deploying B3.5 API
-- Safe to run multiple times (IF NOT EXISTS)

-- ── chit_messages table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS chit_messages (
  message_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_id               UUID NOT NULL REFERENCES chit_header(chit_id) ON DELETE CASCADE,
  sender_entity_id      UUID NOT NULL REFERENCES identities(identity_id),
  sender_display_name   VARCHAR(200) NOT NULL,
  thread_type           VARCHAR(20)  NOT NULL CHECK (thread_type IN ('external','internal')),
  visibility_entity_id  UUID REFERENCES identities(identity_id),
  -- NULL = external (all participants see)
  -- entity_id = internal (only that entity sees)
  message_text          TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for fast lookup
CREATE INDEX IF NOT EXISTS idx_chit_messages_chit_id
  ON chit_messages(chit_id);
CREATE INDEX IF NOT EXISTS idx_chit_messages_visibility
  ON chit_messages(chit_id, visibility_entity_id);
CREATE INDEX IF NOT EXISTS idx_chit_messages_thread
  ON chit_messages(chit_id, thread_type);

COMMENT ON TABLE chit_messages IS
  'Dual thread messaging on chits. thread_type=external: all parties see. thread_type=internal: only sender entity sees.';

-- ── chit_disputes table ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS chit_disputes (
  dispute_id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_id                 UUID NOT NULL REFERENCES chit_header(chit_id) ON DELETE CASCADE,
  raised_by_entity_id     UUID NOT NULL REFERENCES identities(identity_id),
  raised_by_display_name  VARCHAR(200) NOT NULL,
  category                VARCHAR(50)  NOT NULL
    CHECK (category IN ('quality','quantity','delivery','payment','docs','other')),
  reason                  TEXT NOT NULL,
  status                  VARCHAR(20)  NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','resolved')),
  resolution_note         TEXT,
  resolved_by_entity_id   UUID REFERENCES identities(identity_id),
  resolved_at             TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_chit_disputes_chit_id
  ON chit_disputes(chit_id);
CREATE INDEX IF NOT EXISTS idx_chit_disputes_status
  ON chit_disputes(chit_id, status);
CREATE INDEX IF NOT EXISTS idx_chit_disputes_entity
  ON chit_disputes(raised_by_entity_id, status);

COMMENT ON TABLE chit_disputes IS
  'Dispute module. One row per dispute. Raiser resolves to own satisfaction. All parties see all disputes.';

-- ── Verify ───────────────────────────────────────────────────
SELECT 'chit_messages' AS table_name,
       COUNT(*) AS existing_rows
FROM chit_messages
UNION ALL
SELECT 'chit_disputes',
       COUNT(*)
FROM chit_disputes;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b135 — W-1 · the STORE registry, and W-2 · voice transcripts.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- CB-CLI-DIRECTIVE-wholesaler-consolidation.md step 3: *"the sender's WhatsApp number (or BSUID) is the key into
-- CB's own record → resolves to a STORE. The store carries a default address. If unknown, create a lightweight
-- contact and flag it."*
--
-- ── ⚠️ WHY A NEW TABLE AND NOT customer_list ────────────────────────────────────────────────────────────────────
-- customer_list requires a `customer_identity_id` — a real platform identity. A retail shop that WhatsApps the
-- wholesaler is not one, and minting an identity for every stranger who messages is exactly what the rail refuses
-- to do (it would put unverified identities on the platform). A LIGHTWEIGHT contact keyed by phone number is the
-- honest shape: enough to attribute and address, not pretending to be a party.
--
-- ── ⚠️⚠️ WITHOUT RLS — ATHI'S EXPLICIT INSTRUCTION (2026-08-11: "complete W-1 and W-2, without RLS") ────────────
-- Stating the trade rather than burying it, because the standing rule is that a new entity-data table defaults
-- WITH RLS:
--   · This IS tenant data. `wholesaler_store` holds one wholesaler's shop list, their phone numbers and their
--     addresses. Under RLS a WHERE-clause mistake returns nothing; without it, the same mistake returns another
--     wholesaler's shops.
--   · The compensating control is that EVERY query in lib/stores.js filters on owner_entity_id, and the column is
--     NOT NULL. That is a discipline, not a guarantee — RLS is the guarantee, and it is the difference between a
--     bug being empty and a bug being a leak.
--   · Turning it on later is four lines and needs no data change; they are written at the bottom of this file,
--     commented out, so it is a copy-paste rather than a rediscovery.
-- Built as instructed. Flagged as asked.

CREATE TABLE IF NOT EXISTS wholesaler_store (
  store_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_entity_id uuid NOT NULL,                 -- the wholesaler this shop list belongs to
  -- The KEY: the number the shop messages from. Normalised to digits-only in the app so +91 90000 11111,
  -- 09000011111 and 9000011111 all resolve to the same shop — a shop that changes how it dials is not a new shop.
  phone_key       text NOT NULL,
  display_name    text NOT NULL,
  address         text,                          -- the DEFAULT delivery address (directive step 7)
  -- An unknown sender still gets a row so the request can be attributed at all, but it is marked provisional so
  -- the wholesaler can see who has never been confirmed. Attribution to "unknown number" is worse than useless.
  provisional     boolean NOT NULL DEFAULT false,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One shop per number per wholesaler. Two rows for one number is how attribution splits in half.
CREATE UNIQUE INDEX IF NOT EXISTS wholesaler_store_key ON wholesaler_store (owner_entity_id, phone_key);
CREATE INDEX IF NOT EXISTS wholesaler_store_owner ON wholesaler_store (owner_entity_id);

COMMENT ON TABLE wholesaler_store IS
  'b135 — lightweight shop contacts keyed by phone (W-1). NOT a platform identity. ⚠️ WITHOUT RLS by instruction (2026-08-11) — every query must filter owner_entity_id; see the commented policy at the foot of this migration.';

-- ── W-2 · VOICE ────────────────────────────────────────────────────────────────────────────────────────────────
-- *"if it's a voice note, transcribe it. KEEP BOTH the audio and the transcript as evidence; a mis-transcription
-- must be traceable."*
--
-- ⚠️ THE TRANSCRIPT NEVER REPLACES THE AUDIO. `raw_text` already holds what the pipeline works from; these columns
-- record that it CAME FROM speech and which engine produced it. Without that, a mis-heard "fifteen" for "fifty" is
-- indistinguishable from a shop that really asked for fifty — and the only way to settle it is the original audio.
-- `capture` is an EXISTING table and keeps the RLS it already has (b104); adding columns does not remove it.
ALTER TABLE capture ADD COLUMN IF NOT EXISTS transcript        text;
ALTER TABLE capture ADD COLUMN IF NOT EXISTS transcript_engine text;
ALTER TABLE capture ADD COLUMN IF NOT EXISTS transcript_at     timestamptz;

COMMENT ON COLUMN capture.transcript IS
  'b135 — the text a voice note was transcribed to. The audio stays in media_refs; this never replaces it, because a mis-transcription is only provable against the original.';

-- ── TO TURN RLS ON LATER (uncomment; no data change needed) ────────────────────────────────────────────────────
-- ALTER TABLE wholesaler_store ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE wholesaler_store FORCE  ROW LEVEL SECURITY;
-- CREATE POLICY wholesaler_store_isolation ON wholesaler_store
--   USING (owner_entity_id = current_setting('app.current_entity', true)::uuid)
--   WITH CHECK (owner_entity_id = current_setting('app.current_entity', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON wholesaler_store TO cb_app;

DO $$
BEGIN
  RAISE NOTICE 'b135: wholesaler_store created WITHOUT RLS (by instruction) — every query filters owner_entity_id in the app';
  RAISE NOTICE 'b135: capture gained transcript / transcript_engine / transcript_at (RLS unchanged — capture keeps b104)';
END $$;

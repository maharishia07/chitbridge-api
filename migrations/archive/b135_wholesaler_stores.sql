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
-- ── ⚠️⚠️ WITH RLS (FORCE) — Athi turned it on 2026-08-11 after the trade-off was stated ────────────────────────
-- Built first WITHOUT (his instruction), then switched on before any second wholesaler exists — which is the
-- right moment: it costs nothing now and gets expensive to retrofit once two tenants hold data.
--
-- ⚠️ TURNING IT ON IS NOT A MIGRATION-ONLY CHANGE. lib/stores.js used plain query(); under FORCE RLS that sees
-- NOTHING (not everything), so resolve() would have found no existing shop and minted a fresh PROVISIONAL one on
-- every message — fragmenting one shop across dozens of contacts and silently destroying the attribution W-1
-- exists to provide. It is now withEntity(owner) throughout. Same lesson as b125.

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
  'b135 — lightweight shop contacts keyed by phone (W-1). NOT a platform identity. WITH RLS (FORCE) — every query runs inside withEntity(owner); see lib/stores.js.';

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

-- ── RLS, ON ──────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE wholesaler_store ENABLE ROW LEVEL SECURITY;
ALTER TABLE wholesaler_store FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wholesaler_store_isolation ON wholesaler_store;
CREATE POLICY wholesaler_store_isolation ON wholesaler_store
  USING       (owner_entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK  (owner_entity_id = current_setting('app.current_entity', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON wholesaler_store TO cb_app;

DO $$
BEGIN
  RAISE NOTICE 'b135: wholesaler_store created WITH RLS (FORCE) — lib/stores.js runs every query inside withEntity(owner)';
  RAISE NOTICE 'b135: capture gained transcript / transcript_engine / transcript_at (RLS unchanged — capture keeps b104)';
END $$;

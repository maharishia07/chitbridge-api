-- b306_party_contact_pref.sql — CO1 privacy (K2): a party's contact consent, per channel and purpose — given, refused or withdrawn,
-- with who noted it, when, and under which notice. The store docs/design/crm/DATA.md §5 designed as "b277" (never written; this round
-- holds b306–b308 only, so it lands here — same columns, plus notice_version).
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — it creates a table, a policy and grants, which cb_app cannot).
--    Nothing was run against any database for this file; it was written offline and read, not executed. Safe to re-run.
--    Until it runs, GET/POST /api/crm/parties/:id/contact-prefs answer 503 { code: 'PRIVACY_NOT_MIGRATED' } (routes/crm.js · lib/privacy.js);
--    the rest of the CRM is untouched.
--
-- docs/design/crm/DATA.md §5 · web docs/research/COMPLIANCE-OBLIGATIONS-2026-10.md K2 · docs/FIELDS.md (the dictionary rows, same change).
-- Law: DPDP Act 2023 s.6 (consent; s.6(10) the burden of proof is on the fiduciary) · Privacy Act 1988 APP 7 + Spam Act 2003 s.16 ·
--      UAE PDPL Art.4, Art.6.
--
-- ⭐ WHAT IS NEW AND WHY NOTHING EXISTING SERVED
--   · party_contact_pref — nothing in the schema holds "may I message this person, for what, and on what basis" (CRM inventory: none;
--     relationships.js lists are explicitly no-consent; identity_documents.consent_at is only for filing an ID document).
-- ⭐ APPEND-ONLY, LIKE party_interaction (b276). A change of mind is a NEW row; the current answer is the newest row per
--   (party, channel, purpose). The old rows are the proof of what was said when (s.6(10)) — so UPDATE and DELETE are revoked.
--
-- ⚠️ Foreign keys are added with ALTER TABLE, never inside CREATE TABLE IF NOT EXISTS (tests/migration-lint.test.cjs).
-- ⚠️ The policy reads current_setting NULLIF-guarded (tests/entity-cast-guard.test.cjs) — an unset shop reads nothing, never raises.
-- RLS: ENABLED + FORCED, one policy rls_entity (owner_entity_id = the shop the request runs as). cb_app: SELECT, INSERT only.

CREATE TABLE IF NOT EXISTS party_contact_pref (
  pref_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_entity_id  uuid NOT NULL,
  party_id         uuid NOT NULL,                 -- the identity id of the other side (customer_list / supplier_list key)
  channel          text NOT NULL,                 -- phone · sms · whatsapp · email · chitbridge
  purpose          text NOT NULL,                 -- service (about something they started) · marketing (offers, news)
  allowed          boolean NOT NULL,
  basis            text NOT NULL,                 -- consent · legitimate_use (DPDP s.7 / PDPL Art.4 — service messages only)
  notice_version   text,                          -- the privacy notice in force when it was noted (NULL until the owner publishes one)
  noted_at         timestamptz NOT NULL DEFAULT now(),
  noted_by         uuid,                          -- who in the shop recorded it (the owner or a co-assist)
  withdrawn_at     timestamptz                    -- set on the row that WITHDRAWS an earlier consent (allowed = false)
);
ALTER TABLE party_contact_pref DROP CONSTRAINT IF EXISTS party_contact_pref_channel_chk;
ALTER TABLE party_contact_pref ADD CONSTRAINT party_contact_pref_channel_chk CHECK (channel IN ('phone', 'sms', 'whatsapp', 'email', 'chitbridge'));
ALTER TABLE party_contact_pref DROP CONSTRAINT IF EXISTS party_contact_pref_purpose_chk;
ALTER TABLE party_contact_pref ADD CONSTRAINT party_contact_pref_purpose_chk CHECK (purpose IN ('service', 'marketing'));
ALTER TABLE party_contact_pref DROP CONSTRAINT IF EXISTS party_contact_pref_basis_chk;
ALTER TABLE party_contact_pref ADD CONSTRAINT party_contact_pref_basis_chk CHECK (basis IN ('consent', 'legitimate_use'));
-- marketing needs consent: "legitimate use" never covers it (DPDP s.7 lists no marketing use; Spam Act s.16 needs consent)
ALTER TABLE party_contact_pref DROP CONSTRAINT IF EXISTS party_contact_pref_marketing_chk;
ALTER TABLE party_contact_pref ADD CONSTRAINT party_contact_pref_marketing_chk CHECK (NOT (purpose = 'marketing' AND allowed AND basis <> 'consent'));
ALTER TABLE party_contact_pref DROP CONSTRAINT IF EXISTS party_contact_pref_withdrawn_chk;
ALTER TABLE party_contact_pref ADD CONSTRAINT party_contact_pref_withdrawn_chk CHECK (withdrawn_at IS NULL OR NOT allowed);
CREATE INDEX IF NOT EXISTS party_contact_pref_party_idx ON party_contact_pref (owner_entity_id, party_id, channel, purpose, noted_at DESC);
ALTER TABLE party_contact_pref ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_contact_pref FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON party_contact_pref;
CREATE POLICY rls_entity ON party_contact_pref
  USING      (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
REVOKE UPDATE, DELETE ON party_contact_pref FROM cb_app;
GRANT SELECT, INSERT ON party_contact_pref TO cb_app;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'party_contact_pref_party_fkey') THEN
    ALTER TABLE party_contact_pref ADD CONSTRAINT party_contact_pref_party_fkey FOREIGN KEY (party_id) REFERENCES identities (identity_id);
  END IF;
END $fk$;
COMMENT ON TABLE party_contact_pref IS 'b306 (CO1 K2) — append-only contact consent per party · channel · purpose; the newest row is the answer. Written by POST /api/crm/parties/:id/contact-prefs; read by GET of the same and lib/privacy.mayMessage.';

-- ── check (one row, after running): 1 | 1 | 5 | f — the table, its RLS policy, the five CHECKs, cb_app may NOT update ──────────
-- SELECT (SELECT count(*) FROM pg_tables WHERE tablename = 'party_contact_pref')
--      , (SELECT count(*) FROM pg_policies WHERE policyname = 'rls_entity' AND tablename = 'party_contact_pref')
--      , (SELECT count(*) FROM pg_constraint WHERE conrelid = 'party_contact_pref'::regclass AND contype = 'c')
--      , has_table_privilege('cb_app', 'party_contact_pref', 'UPDATE');

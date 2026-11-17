-- b765_move_in_import.sql — move-in W1.10 + W1.4 (2026-10-18): THE MATCH PROOF OF EVERY MOVE-IN, KEPT WITH THE IMPORT. ONE new table, insert-only.
-- OWNER: lib/move-in-proof.js (writes and reads it; lib/move-in.js apply() calls it on the import's own transaction)
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Written offline, read, never executed. Safe to re-run (IF NOT EXISTS throughout;
--    the policy is dropped and created again).
--    Until it runs: POST /api/books/move-in/import still answers the proof in its reply, with proof_stored:false and the sentence "… b765 is still to run";
--    GET /api/books/move-in/imports answers ready:false with that sentence; the one-company check (W1.4) has nothing to compare with. Never a 500.
--
-- RLS: ENABLE + FORCE, the books' own entity policy (b272: entity_id = app.current_entity). cb_app gets SELECT and INSERT only — NO UPDATE, NO DELETE:
--    a proof once kept is the paper an auditor reads (a fresh file is a fresh import). Nothing here is posted: the import's entries live in journal_*.
--
-- WHY (DECISIONS 2026-10-18:64): "every migration … shows a MATCH PROOF against the sending system … The proof is kept with the import (auditor-ready)".
--    And :62/:70 — the source country (read from their system, or stated by the owner for a file) is recorded with it; W1.4 — one source company per shop.
--
-- WHAT (chitbridge-api docs/FIELDS.md "move_in_import"):
--   import_id       uuid   the import (one file, one kind)
--   source          text   xero · qbo — whose books (lib/move-in SOURCES)
--   company_id      text   THEIR company id when known (QBO realmId · Xero OrganisationID · Zoho organization_id), ≤ 80; a second, different one is refused
--   source_country  text   the two-letter country the books are from — equal to the shop's (the gate refused anything else)
--   country_how     text   stated (the owner said it, a file) · read (from their system's company record)
--   kind            text   accounts · contacts · items · trial_balance · open_bills
--   side            text   customer · supplier (contacts) · receivable · payable (open_bills) · null
--   as_at           date   the move date
--   counts          jsonb  { added, merged, skipped, held } — what landed
--   proof           jsonb  lib/move-in-proof build(): documents · parties · accounts · tax_codes · contacts · held [{ line, what, code, why }] · differences
--   created_by      uuid   who imported it (the owner)
CREATE TABLE IF NOT EXISTS move_in_import (
  import_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL,
  source          text NOT NULL CHECK (char_length(source) BETWEEN 1 AND 20),
  company_id      text CHECK (company_id IS NULL OR char_length(company_id) <= 80),
  source_country  text NOT NULL CHECK (source_country ~ '^[A-Z]{2}$'),
  country_how     text NOT NULL CHECK (country_how IN ('stated', 'read')),
  kind            text NOT NULL CHECK (kind IN ('accounts', 'contacts', 'items', 'trial_balance', 'open_bills')),
  side            text CHECK (side IS NULL OR side IN ('customer', 'supplier', 'receivable', 'payable')),
  as_at           date,
  counts          jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(counts) = 'object'),
  proof           jsonb NOT NULL CHECK (jsonb_typeof(proof) = 'object'),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS move_in_import_entity_idx ON move_in_import (entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS move_in_import_company_idx ON move_in_import (entity_id, source, company_id) WHERE company_id IS NOT NULL;

ALTER TABLE move_in_import ENABLE ROW LEVEL SECURITY;
ALTER TABLE move_in_import FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON move_in_import;
CREATE POLICY rls_entity ON move_in_import
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

GRANT SELECT, INSERT ON move_in_import TO cb_app;
-- the default privileges also hand cb_app UPDATE/DELETE (live needed this on 2026-10-18): take them back, so insert-only is true
REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON move_in_import FROM cb_app;
COMMENT ON TABLE move_in_import IS 'move-in W1.10: one import (one file, one kind) with its match proof, the source country (stated / read) and their company id; insert-only, never posted';

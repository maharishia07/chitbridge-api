-- b274_books_party.sql — BOOKS v2, part 3 of 3: the party master (on the lists that already exist) and the packs.
-- SPEC-books-v2.md §1/§4/§6 · research §6.1 ("party ≠ a new table"). Run after b273. Safe to re-run.
--
-- ⭐ THE PARTY IS NOT A NEW LIST. Every counterparty is already an identity (on-rail, or a local `~shop.name` one —
--   lib/local-identity.js) held by the shop in customer_list and/or supplier_list. Those rows gain the fields a ledger
--   needs; a party that is BOTH is the same identity in both lists and carries the same party_no (one series per shop).

-- ── the fields, on both lists ─────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE customer_list ADD COLUMN IF NOT EXISTS nickname           varchar(80);
ALTER TABLE customer_list ADD COLUMN IF NOT EXISTS legal_name         text;
ALTER TABLE customer_list ADD COLUMN IF NOT EXISTS party_no           text;
ALTER TABLE customer_list ADD COLUMN IF NOT EXISTS credit_days        int;
ALTER TABLE customer_list ADD COLUMN IF NOT EXISTS credit_limit_minor bigint;
ALTER TABLE customer_list ADD COLUMN IF NOT EXISTS state_code         text;
ALTER TABLE customer_list ADD COLUMN IF NOT EXISTS merged_into        uuid;
ALTER TABLE supplier_list ADD COLUMN IF NOT EXISTS legal_name         text;
ALTER TABLE supplier_list ADD COLUMN IF NOT EXISTS party_no           text;
ALTER TABLE supplier_list ADD COLUMN IF NOT EXISTS credit_days        int;
ALTER TABLE supplier_list ADD COLUMN IF NOT EXISTS credit_limit_minor bigint;
ALTER TABLE supplier_list ADD COLUMN IF NOT EXISTS state_code         text;
ALTER TABLE supplier_list ADD COLUMN IF NOT EXISTS merged_into        uuid;
-- a party number is never reused within a shop (both lists draw from books_counter series 'P')
CREATE UNIQUE INDEX IF NOT EXISTS customer_list_party_no_uq ON customer_list (owner_entity_id, party_no) WHERE party_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_list_party_no_uq ON supplier_list (owner_entity_id, party_no) WHERE party_no IS NOT NULL;
ALTER TABLE customer_list DROP CONSTRAINT IF EXISTS customer_list_credit_chk;
ALTER TABLE customer_list ADD CONSTRAINT customer_list_credit_chk CHECK ((credit_days IS NULL OR credit_days >= 0) AND (credit_limit_minor IS NULL OR credit_limit_minor >= 0));
ALTER TABLE supplier_list DROP CONSTRAINT IF EXISTS supplier_list_credit_chk;
ALTER TABLE supplier_list ADD CONSTRAINT supplier_list_credit_chk CHECK ((credit_days IS NULL OR credit_days >= 0) AND (credit_limit_minor IS NULL OR credit_limit_minor >= 0));

-- ── tax ids as (scheme, value) pairs — GSTIN, PAN, TRN … — with the duplicate-party check the research names ─────
CREATE TABLE IF NOT EXISTS party_tax_id (
  owner_entity_id  uuid NOT NULL,
  party_id         uuid NOT NULL,
  scheme           text NOT NULL,                -- GSTIN · PAN · TRN · VAT …
  value            text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_entity_id, party_id, scheme)
);
-- ⚠️ the same GSTIN on two parties of one shop is the duplicate-party fault (research §5) — refused by the index
CREATE UNIQUE INDEX IF NOT EXISTS party_tax_id_value_uq ON party_tax_id (owner_entity_id, scheme, upper(value));
ALTER TABLE party_tax_id ENABLE ROW LEVEL SECURITY;
ALTER TABLE party_tax_id FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON party_tax_id;
CREATE POLICY rls_entity ON party_tax_id
  USING      (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON party_tax_id TO cb_app;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'party_tax_id_party_fkey') THEN
    ALTER TABLE party_tax_id ADD CONSTRAINT party_tax_id_party_fkey FOREIGN KEY (party_id) REFERENCES identities (identity_id);
  END IF;
END $fk$;

-- ── the handover packs (research offload §5): month · year · exit, hash-chained, acknowledged by the shop ─────────
CREATE TABLE IF NOT EXISTS books_pack (
  pack_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid NOT NULL,
  kind             text NOT NULL,                -- month · year · exit
  fiscal_year      text,
  period           int,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid,
  sha256           text NOT NULL,
  prev_sha256      text,                         -- the previous pack's hash — the chain a missing month breaks
  manifest         jsonb NOT NULL,               -- files, sizes, hashes, control totals
  storage_path     text,
  delivered_at     timestamptz,
  acknowledged_at  timestamptz,
  acknowledged_by  uuid,
  delete_after     date                          -- year end + 8 years (India; per country pack)
);
ALTER TABLE books_pack DROP CONSTRAINT IF EXISTS books_pack_kind_chk;
ALTER TABLE books_pack ADD CONSTRAINT books_pack_kind_chk CHECK (kind IN ('month', 'year', 'exit'));
CREATE INDEX IF NOT EXISTS books_pack_idx ON books_pack (entity_id, created_at);
ALTER TABLE books_pack ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_pack FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON books_pack;
CREATE POLICY rls_entity ON books_pack
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
REVOKE DELETE ON books_pack FROM cb_app;
GRANT SELECT, INSERT, UPDATE ON books_pack TO cb_app;

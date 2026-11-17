-- b858_till_invoice_lease.sql — CTR-213 (ACC-192 S2, 13 Nov 2026): a till LEASES a block of invoice numbers from the server's ONE invoice counter.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), after SIT has run it. Safe to repeat (IF NOT EXISTS / DROP POLICY IF EXISTS first). It touches no row and
--    no existing table: a new table nothing reads until the CTR-213 build ships, and that code checks schema.hasTable first, so the api is correct BEFORE and AFTER this file runs.
-- NUMBER. api main ends at b854; open PRs 1246/1247/1234/1226 hold b855, b856, b857 (checked 2026-11-13) → b858 is the next free one.
-- LOOKED AT (DISCIPLINES 4a): books_counter (series 'invoice', fiscal_year '-': the ONE per-issuer counter, S1 of ACC-192, api #990); a block is reserved ONLY by books-store nextNo(count = N),
--    so two tills asking at once get disjoint ranges (the counter statement is one atomic upsert). This table stores WHO holds which range; it never invents a number.
-- WHAT IT IS. One row per leased block: till_id (the counter id in identities.policy_flags.counters), first_no..last_no (inclusive, integers of the one series), leased_at, expires_at,
--    closed_at (set when the till or the owner closes the lease at day close), unused_json = [{ "no": 31, "reason": "void" | "unused" | "retired" }] — the reasons for numbers the
--    lease did not turn into an invoice. A number with no invoice, below the highest used one, and NO reason is reported as a GAP, never filled and never hidden.
--    An expired lease is never re-leased: its numbers may be on paper already (offline), so a number is handed out once, ever.
-- UNIQUE (entity_id, first_no): two leases of one issuer can never start at the same number. The ranges never overlap because they come from the counter, not from this table.
-- OWNER: lib/invoice-lease.js (the lease, the day close report, the close with reasons); routes/till.js only reads the request.
-- ROLL BACK (before the build ships it loses nothing; after, the day close loses its lease list, the invoices themselves are untouched):
--    DROP TABLE IF EXISTS till_invoice_lease;
-- CHECK (read-only, one row):   SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'till_invoice_lease';   Expect 1.
-- RLS: ENABLE + FORCE + the one entity policy (as books_counter). cb_app may SELECT, INSERT and UPDATE (closing a lease and noting reasons are updates; no DELETE: a lease is a record).

CREATE TABLE IF NOT EXISTS till_invoice_lease (
  lease_id    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid        NOT NULL,
  till_id     text        NOT NULL,
  first_no    bigint      NOT NULL CHECK (first_no >= 1),
  last_no     bigint      NOT NULL,
  leased_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  closed_at   timestamptz,
  unused_json jsonb       NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(unused_json) = 'array'),
  CONSTRAINT till_invoice_lease_range CHECK (last_no >= first_no),
  CONSTRAINT till_invoice_lease_first_uq UNIQUE (entity_id, first_no));
-- WHY: the lease route reads one till's open blocks (entity_id leads for RLS); the unique key above leads with entity_id, first_no and cannot serve a till_id read
CREATE INDEX IF NOT EXISTS till_invoice_lease_till_idx ON till_invoice_lease (entity_id, till_id, first_no);

ALTER TABLE till_invoice_lease ENABLE ROW LEVEL SECURITY;  ALTER TABLE till_invoice_lease FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON till_invoice_lease;
CREATE POLICY rls_entity ON till_invoice_lease
  USING (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

REVOKE ALL ON till_invoice_lease FROM cb_app, cb_backup;
GRANT SELECT, INSERT, UPDATE ON till_invoice_lease TO cb_app;
GRANT SELECT ON till_invoice_lease TO cb_backup;
COMMENT ON TABLE till_invoice_lease IS 'CTR-213: a block of invoice numbers (first_no..last_no of the issuer''s one books_counter series invoice) leased to one till; the numbers are reserved by nextNo, never by this table';

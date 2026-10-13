-- b309_books_compare.sql — PR1 (2026-10-13): THE PARALLEL-RUN SNAPSHOTS — an auditor's Tally (IN) or Xero / QuickBooks (AU) period, read from its export
--   files and kept beside our books so CB Accounts › Parallel run can compare them line by line. ONE new table, insert-only.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Written offline, read, never executed. Safe to re-run (IF NOT EXISTS throughout;
--    the policy is dropped and created again).
--    Until it runs: GET /api/books/compare answers ready:false WITH the sentence and the screen greys "Load their figures" with it; the other compare
--    routes answer 503 BOOKS_NOT_MIGRATED in words. Never a 500. Nothing else reads this table.
--
-- RLS: ENABLE + FORCE, the books' own entity policy (b272: entity_id = app.current_entity). cb_app gets SELECT and INSERT only — NO UPDATE, NO DELETE:
--    a part once kept is the paper that was compared (a fresh file is a fresh snapshot). The table is NEVER posted from: nothing here reaches journal_*.
--
-- WHAT (chitbridge-api docs/FIELDS.md "books_compare_part"):
--   snapshot_id  uuid   the snapshot a part belongs to (the server mints it with the first part; later parts name it)
--   label        text   the person's name for it ("Tally FY 2026-27 H1"), ≤ 80
--   source       text   tally · xero · qbo — whose figures these are
--   part         text   tb (trial balance as at period_to) · pl (profit and loss for period_from..period_to) · bs (balance sheet as at period_to) ·
--                       ret (their return for the period: BAS / VAT201 / GSTR-3B boxes)
--   period_from  date   the period's first day (null for a part read "as at")
--   period_to    date   the period's last day — the "as at" of tb / bs
--   currency     text   the shop's functional currency when it was read (the minor units below are in it)
--   file_name    text   the file the person picked, for the auditor's file
--   rows         jsonb  [{ line, name, code, group, side, dr_minor, cr_minor, amount_minor, tax_minor }] — THEIR lines as read, integers in minor units
--   created_by   uuid   who loaded it (the owner, or the shop's auditor)
CREATE TABLE IF NOT EXISTS books_compare_part (
  part_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL,
  snapshot_id  uuid NOT NULL,
  label        text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 80),
  source       text NOT NULL CHECK (source IN ('tally', 'xero', 'qbo')),
  part         text NOT NULL CHECK (part IN ('tb', 'pl', 'bs', 'ret')),
  period_from  date,
  period_to    date NOT NULL,
  currency     text NOT NULL,
  file_name    text,
  rows         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(rows) = 'array'),
  created_by   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, snapshot_id, part)
);
CREATE INDEX IF NOT EXISTS books_compare_part_entity_idx ON books_compare_part (entity_id, created_at DESC);

ALTER TABLE books_compare_part ENABLE ROW LEVEL SECURITY;
ALTER TABLE books_compare_part FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON books_compare_part;
CREATE POLICY rls_entity ON books_compare_part
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

GRANT SELECT, INSERT ON books_compare_part TO cb_app;
COMMENT ON TABLE books_compare_part IS 'PR1: a parallel-run snapshot part — their TB / P&L / BS / return as read from a Tally / Xero / QBO export; insert-only, never posted';

-- b272_books_ledger.sql — BOOKS v2, part 1 of 3: the switch, the chart of accounts, the periods, the number series.
-- SPEC-books-v2.md §1 · RESEARCH-ledger-design-2026-09-29.md §6.1. For Athi to run in the Supabase editor, in order
-- b272 → b273 → b274 (docs/drafts/BOOKS-RUN-ORDER.md has the one-row check after each). Safe to re-run.
--
-- ⚠️⚠️ RUN AS postgres IN THE SUPABASE SQL EDITOR — WITHOUT RLS. It creates tables, policies and grants, which the
--    application role cannot do: run as cb_app it fails on the first CREATE.
--
-- ⚠️ NOTHING POSTS UNTIL books_setting.enabled IS TRUE for a shop — creating these tables changes nothing a shop sees.
-- ⚠️ Every table is entity-scoped, ENABLE + FORCE row-level security, current_setting NULLIF-guarded (an unset shop
--    reads nothing instead of raising on ''::uuid). Foreign keys are added with ALTER TABLE, never inside
--    CREATE TABLE IF NOT EXISTS (b250/b262/b264 lost theirs that way — tests/migration-lint.test.cjs).

-- ── books_setting · one row per shop: the switch and its choices ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS books_setting (
  entity_id            uuid PRIMARY KEY,
  enabled              boolean NOT NULL DEFAULT false,
  walkin_grain         text NOT NULL DEFAULT 'day',        -- day | shift | bill (SPEC-books v1 §granularity)
  fy_start_month       int  NOT NULL DEFAULT 4,            -- India: April
  functional_currency  text NOT NULL DEFAULT 'INR',
  country              text NOT NULL DEFAULT 'IN',
  pack_version         text,                               -- the accounts-packs version the chart was seeded from
  enabled_at           timestamptz,
  enabled_by           uuid,
  last_check           jsonb,                              -- the nightly check's last result (GET /api/books/health)
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE books_setting DROP CONSTRAINT IF EXISTS books_setting_grain_chk;
ALTER TABLE books_setting ADD CONSTRAINT books_setting_grain_chk CHECK (walkin_grain IN ('day', 'shift', 'bill'));
ALTER TABLE books_setting DROP CONSTRAINT IF EXISTS books_setting_fy_chk;
ALTER TABLE books_setting ADD CONSTRAINT books_setting_fy_chk CHECK (fy_start_month BETWEEN 1 AND 12);

-- ── ledger_account · the chart, per shop (seeded from accounts-packs; a shop may add its own under a group) ──────
CREATE TABLE IF NOT EXISTS ledger_account (
  account_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      uuid NOT NULL,
  code           text NOT NULL,                  -- 1300 · 4000 · 6010 … (India pack; a shop may renumber)
  name           text NOT NULL,
  parent_id      uuid,                           -- the group tree (Tally's 28 groups are the top)
  is_group       boolean NOT NULL DEFAULT false,
  nature         text NOT NULL,                  -- asset | liability | equity | income | expense
  role           text,                           -- the posting rules' key (debtors, cash, output_cgst …); null = the shop's own
  pack_code      text,
  pack_version   text,
  tally_group    text,
  sch3_line      text,                           -- Schedule III line
  saft_grouping  text,                           -- SAF-T GroupingCategory/Code
  xbrl_element   text,
  currency       text,                           -- null = the functional currency
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid
);
ALTER TABLE ledger_account DROP CONSTRAINT IF EXISTS ledger_account_nature_chk;
ALTER TABLE ledger_account ADD CONSTRAINT ledger_account_nature_chk CHECK (nature IN ('asset', 'liability', 'equity', 'income', 'expense'));
CREATE UNIQUE INDEX IF NOT EXISTS ledger_account_code_uq ON ledger_account (entity_id, code);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_account_role_uq ON ledger_account (entity_id, role) WHERE role IS NOT NULL;
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ledger_account_parent_fkey') THEN
    ALTER TABLE ledger_account ADD CONSTRAINT ledger_account_parent_fkey FOREIGN KEY (parent_id) REFERENCES ledger_account (account_id);
  END IF;
END $fk$;

-- ── fiscal_period · months of a financial year (period 0 = brought forward); open → soft_locked → hard_locked ───
CREATE TABLE IF NOT EXISTS fiscal_period (
  entity_id    uuid NOT NULL,
  fiscal_year  text NOT NULL,                    -- '2026-27'
  period       int  NOT NULL,                    -- 0 (brought forward) · 1–12 from the year's first month
  start_date   date NOT NULL,
  end_date     date NOT NULL,
  status       text NOT NULL DEFAULT 'open',
  locked_by    uuid,
  locked_at    timestamptz,
  reason       text,
  PRIMARY KEY (entity_id, fiscal_year, period)
);
ALTER TABLE fiscal_period DROP CONSTRAINT IF EXISTS fiscal_period_status_chk;
ALTER TABLE fiscal_period ADD CONSTRAINT fiscal_period_status_chk CHECK (status IN ('open', 'soft_locked', 'hard_locked'));
ALTER TABLE fiscal_period DROP CONSTRAINT IF EXISTS fiscal_period_period_chk;
ALTER TABLE fiscal_period ADD CONSTRAINT fiscal_period_period_chk CHECK (period BETWEEN 0 AND 12);

-- ── books_counter · gap-free number series (journal entries per year; party numbers per shop) ───────────────────
-- Incremented inside the posting transaction (INSERT … ON CONFLICT DO UPDATE … RETURNING), so a rolled-back post
-- gives its number back and the series has no gaps (Rule 3 / auditors expect a continuous voucher series).
CREATE TABLE IF NOT EXISTS books_counter (
  entity_id    uuid NOT NULL,
  series       text NOT NULL,                    -- 'JV' · 'P'
  fiscal_year  text NOT NULL DEFAULT '-',        -- '-' for a series that does not restart (party numbers)
  next_no      bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (entity_id, series, fiscal_year)
);

-- ── row-level security: every table above, on its entity key ─────────────────────────────────────────────────────
ALTER TABLE books_setting  ENABLE ROW LEVEL SECURITY;  ALTER TABLE books_setting  FORCE ROW LEVEL SECURITY;
ALTER TABLE ledger_account ENABLE ROW LEVEL SECURITY;  ALTER TABLE ledger_account FORCE ROW LEVEL SECURITY;
ALTER TABLE fiscal_period  ENABLE ROW LEVEL SECURITY;  ALTER TABLE fiscal_period  FORCE ROW LEVEL SECURITY;
ALTER TABLE books_counter  ENABLE ROW LEVEL SECURITY;  ALTER TABLE books_counter  FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON books_setting;
CREATE POLICY rls_entity ON books_setting
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS rls_entity ON ledger_account;
CREATE POLICY rls_entity ON ledger_account
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS rls_entity ON fiscal_period;
CREATE POLICY rls_entity ON fiscal_period
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS rls_entity ON books_counter;
CREATE POLICY rls_entity ON books_counter
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- the default grants (b48) give cb_app DELETE on every new table. Nothing in the server deletes from these four (a ledger
-- is switched off, never removed; a month is locked, never dropped; a number series only moves forward) — and a deleted
-- hard-locked month would simply be recreated OPEN by the next entry. So the application role may not delete them.
REVOKE DELETE ON books_setting, ledger_account, fiscal_period, books_counter FROM cb_app;
GRANT SELECT, INSERT, UPDATE ON books_setting, ledger_account, fiscal_period, books_counter TO cb_app;

-- ── the one cross-shop read the nightly check needs: WHICH shops have books on — ids only, never a row of books ──
-- (the ops.f_entity_counts pattern, b241: SECURITY DEFINER, returns nothing a shop could not already know about itself)
CREATE SCHEMA IF NOT EXISTS ops;
DROP FUNCTION IF EXISTS ops.f_books_enabled();   -- a RETURNS TABLE cannot be REPLACEd with a new row type (b240+ rule)
CREATE OR REPLACE FUNCTION ops.f_books_enabled()
RETURNS TABLE (entity_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $f$
  SELECT s.entity_id FROM books_setting s WHERE s.enabled
$f$;
REVOKE ALL ON FUNCTION ops.f_books_enabled() FROM PUBLIC;
GRANT USAGE ON SCHEMA ops TO cb_app;
GRANT EXECUTE ON FUNCTION ops.f_books_enabled() TO cb_app;

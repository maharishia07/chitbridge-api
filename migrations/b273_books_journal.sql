-- b273_books_journal.sql — BOOKS v2, part 2 of 3: the journal, the running balances, the open items, the payments.
-- SPEC-books-v2.md §1/§3 · research §6.1/§6.3. Run after b272. Safe to re-run.
--
-- ⚠️⚠️ RUN AS postgres IN THE SUPABASE SQL EDITOR — WITHOUT RLS. It creates tables, policies and grants, which the
--    application role cannot do: run as cb_app it fails on the first CREATE.
--
-- ⭐ THE JOURNAL IS INSERT-ONLY (Companies (Accounts) Rules 3(1): an audit trail that cannot be switched off). A
--   correction is a REVERSING entry that points at the one it reverses (reverses_entry_id) — never an UPDATE, never a
--   DELETE. A trigger refuses both, and cb_app is granted neither, so it holds even for a hand-written query.
-- ⭐ ONE WRITER: lib/books.js postEntry() writes journal_entry, journal_line, account_balance and party_item in ONE
--   transaction (tests/books-writer.test.cjs fails on any other writer).
-- ⭐ account_balance is DERIVED (Oracle GL_BALANCES / SAP GLT0): updated in the same transaction as each post, so
--   reads never scan history; the nightly check recomputes it from the lines and names any difference.

CREATE TABLE IF NOT EXISTS journal_entry (
  entry_id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          uuid NOT NULL,
  entry_no           text NOT NULL,              -- JV/2026-27/000001 — gap-free per shop per financial year
  series             text NOT NULL DEFAULT 'JV',
  posting_date       date NOT NULL,              -- the date that counts (moved to the first open date if its month is locked)
  doc_date           date,                       -- the source document's own date, always kept
  fiscal_year        text NOT NULL,
  period             int  NOT NULL,
  source_chit_id     uuid,
  source_ref         text,                       -- the idempotency key: one source never posts twice
  event_type         text NOT NULL,              -- walkin_day · sale_bill · purchase_bill · payment_received · …
  rule_version       text,
  reverses_entry_id  uuid,
  is_opening         boolean NOT NULL DEFAULT false,
  narration          text,
  currency           text NOT NULL,
  total_minor        bigint NOT NULL,            -- Σ debits = Σ credits, in minor units
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS journal_entry_no_uq  ON journal_entry (entity_id, entry_no);
CREATE UNIQUE INDEX IF NOT EXISTS journal_entry_src_uq ON journal_entry (entity_id, source_ref) WHERE source_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS journal_entry_date_idx ON journal_entry (entity_id, posting_date);
CREATE INDEX IF NOT EXISTS journal_entry_chit_idx ON journal_entry (entity_id, source_chit_id);

-- the chits a SUMMARY entry covers: a walk-in day names the bills it summed, so a bill it does not name posts as a late
-- bill instead of waiting for ever (critic M7); the nightly sweep reads it too. Null on every per-document entry.
ALTER TABLE journal_entry ADD COLUMN IF NOT EXISTS source_chit_ids uuid[];
CREATE INDEX IF NOT EXISTS journal_entry_covers_gin ON journal_entry USING gin (source_chit_ids) WHERE source_chit_ids IS NOT NULL;

CREATE TABLE IF NOT EXISTS journal_line (
  line_id           bigserial PRIMARY KEY,
  entry_id          uuid NOT NULL,
  entity_id         uuid NOT NULL,
  line_no           int  NOT NULL,
  account_id        uuid NOT NULL,
  party_id          uuid,                        -- required on debtors / creditors lines (checked by postEntry)
  dr_minor          bigint NOT NULL DEFAULT 0,
  cr_minor          bigint NOT NULL DEFAULT 0,
  currency          text NOT NULL,
  amount_txn_minor  bigint,                      -- the amount in the transaction currency (INR-only today; there from day one)
  fx_rate           numeric NOT NULL DEFAULT 1,
  counter_id        text,
  outlet_id         text,
  cost_centre       text,
  tax_rate          text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE journal_line DROP CONSTRAINT IF EXISTS journal_line_side_chk;
ALTER TABLE journal_line ADD CONSTRAINT journal_line_side_chk CHECK ((dr_minor > 0 AND cr_minor = 0) OR (cr_minor > 0 AND dr_minor = 0));
CREATE INDEX IF NOT EXISTS journal_line_entry_idx   ON journal_line (entry_id);
CREATE INDEX IF NOT EXISTS journal_line_account_idx ON journal_line (entity_id, account_id);
CREATE INDEX IF NOT EXISTS journal_line_party_idx   ON journal_line (entity_id, party_id) WHERE party_id IS NOT NULL;

-- the running balance per account per month (party_key = the zero uuid for the account's own total; a party for
-- debtors / creditors — the SAP KNC1/LFC1 pattern)
CREATE TABLE IF NOT EXISTS account_balance (
  entity_id    uuid NOT NULL,
  account_id   uuid NOT NULL,
  party_key    uuid NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
  currency     text NOT NULL,
  fiscal_year  text NOT NULL,
  period       int  NOT NULL,                    -- 0 = brought forward · 1–12
  dr_minor     bigint NOT NULL DEFAULT 0,
  cr_minor     bigint NOT NULL DEFAULT 0,
  line_count   int    NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  rebuilt_at   timestamptz,
  PRIMARY KEY (entity_id, account_id, party_key, currency, fiscal_year, period)
);

-- the open items: a bill opens (+), payments / credit notes / write-offs settle (−), each against the bill it names
-- (ERPNext Payment Ledger Entry · Tally bill-wise). Disputes and cheque stages are STATUS rows, never an UPDATE.
-- (the row shape is CBReceivables' party_item, engines v1.8.0: ref = the document the row comes from, against_ref = the
--  document it counts against; a payment sits −amount against ITSELF until allocated; a cheque not yet cleared is a
--  status row holding pending_minor; a bounce is a reversal row per money row, naming the row it reverses)
CREATE TABLE IF NOT EXISTS party_item (
  item_id        bigserial PRIMARY KEY,
  entity_id      uuid NOT NULL,
  party_id       uuid NOT NULL,
  account_id     uuid NOT NULL,                  -- debtors or creditors
  side           text NOT NULL,                  -- receivable (a customer) · payable (a supplier)
  ref            text NOT NULL,                  -- the document this row comes from (a bill, a payment, a credit note)
  against_ref    text NOT NULL,                  -- the document it counts against (a bill's own row points at itself)
  ref_kind       text NOT NULL,                  -- bill · advance · on_account · allocation · reversal · status
  kind           text,                           -- the source: sale · credit_given · opening_balance · payment · return …
  amount_minor   bigint NOT NULL DEFAULT 0,      -- signed: + opens, − settles (a status row carries 0)
  pending_minor  bigint,                         -- a cheque not yet cleared: the money its status row holds
  currency       text NOT NULL,
  due_date       date,
  doc_date       date,
  status         text,                           -- on a status row: disputed · undisputed · received · deposited · cleared · bounced
  reverses       text,                           -- a reversal row: the item it reverses
  reverses_kind  text,
  entry_id       uuid,
  payment_id     uuid,
  note           text,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE party_item DROP CONSTRAINT IF EXISTS party_item_side_chk;
ALTER TABLE party_item ADD CONSTRAINT party_item_side_chk CHECK (side IN ('receivable', 'payable'));
ALTER TABLE party_item DROP CONSTRAINT IF EXISTS party_item_kind_chk;
ALTER TABLE party_item ADD CONSTRAINT party_item_kind_chk CHECK (ref_kind IN ('bill', 'advance', 'on_account', 'allocation', 'reversal', 'status'));
CREATE INDEX IF NOT EXISTS party_item_party_idx ON party_item (entity_id, party_id, against_ref);
CREATE INDEX IF NOT EXISTS party_item_ref_idx ON party_item (entity_id, ref);

-- a payment as it was recorded (C4: the supplier's own record) — its stage and its matching live in party_item rows
CREATE TABLE IF NOT EXISTS books_payment (
  payment_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      uuid NOT NULL,
  party_id       uuid NOT NULL,
  direction      text NOT NULL,                  -- in (received) · out (made)
  amount_minor   bigint NOT NULL,
  currency       text NOT NULL,
  mode           text NOT NULL,                  -- cash · bank · upi · card · cheque
  reference      text,
  cheque_no      text,
  cheque_bank    text,
  cheque_date    date,
  received_at    date NOT NULL,
  client_ref     text,                           -- a counter's own id for it: a replay never records it twice
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE books_payment DROP CONSTRAINT IF EXISTS books_payment_dir_chk;
ALTER TABLE books_payment ADD CONSTRAINT books_payment_dir_chk CHECK (direction IN ('in', 'out'));
ALTER TABLE books_payment DROP CONSTRAINT IF EXISTS books_payment_amt_chk;
ALTER TABLE books_payment ADD CONSTRAINT books_payment_amt_chk CHECK (amount_minor > 0);
CREATE UNIQUE INDEX IF NOT EXISTS books_payment_client_uq ON books_payment (entity_id, client_ref) WHERE client_ref IS NOT NULL;

-- what could not be posted yet, and why — a failed post never fails the chit; it waits here and is NAMED
CREATE TABLE IF NOT EXISTS books_outbox (
  id              bigserial PRIMARY KEY,
  entity_id       uuid NOT NULL,
  source_chit_id  uuid,
  source_ref      text,
  event           jsonb NOT NULL,
  why             text,
  tries           int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  done_at         timestamptz
);
CREATE INDEX IF NOT EXISTS books_outbox_open_idx ON books_outbox (entity_id) WHERE done_at IS NULL;

-- master changes (chart, party fields, period locks, settings): who, when, field, old, new — append-only (Rule 3)
CREATE TABLE IF NOT EXISTS books_change_log (
  id          bigserial PRIMARY KEY,
  entity_id   uuid NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  by          uuid,
  table_name  text NOT NULL,
  row_id      text,
  field       text,
  old         text,
  new         text
);
CREATE INDEX IF NOT EXISTS books_change_log_idx ON books_change_log (entity_id, at);

-- ── foreign keys, outside CREATE TABLE (b250's lesson) ────────────────────────────────────────────────────────────
DO $fk$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_line_entry_fkey') THEN
    ALTER TABLE journal_line ADD CONSTRAINT journal_line_entry_fkey FOREIGN KEY (entry_id) REFERENCES journal_entry (entry_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_line_account_fkey') THEN
    ALTER TABLE journal_line ADD CONSTRAINT journal_line_account_fkey FOREIGN KEY (account_id) REFERENCES ledger_account (account_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'journal_entry_reverses_fkey') THEN
    ALTER TABLE journal_entry ADD CONSTRAINT journal_entry_reverses_fkey FOREIGN KEY (reverses_entry_id) REFERENCES journal_entry (entry_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'account_balance_account_fkey') THEN
    ALTER TABLE account_balance ADD CONSTRAINT account_balance_account_fkey FOREIGN KEY (account_id) REFERENCES ledger_account (account_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'party_item_account_fkey') THEN
    ALTER TABLE party_item ADD CONSTRAINT party_item_account_fkey FOREIGN KEY (account_id) REFERENCES ledger_account (account_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'party_item_entry_fkey') THEN
    ALTER TABLE party_item ADD CONSTRAINT party_item_entry_fkey FOREIGN KEY (entry_id) REFERENCES journal_entry (entry_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'party_item_payment_fkey') THEN
    ALTER TABLE party_item ADD CONSTRAINT party_item_payment_fkey FOREIGN KEY (payment_id) REFERENCES books_payment (payment_id);
  END IF;
END $fk$;

-- ── insert-only, by trigger AND by grant ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION books_insert_only() RETURNS trigger LANGUAGE plpgsql AS $t$
BEGIN
  RAISE EXCEPTION 'The books are insert-only: % on % is refused — correct with a reversing entry (Rule 3 audit trail).', TG_OP, TG_TABLE_NAME;
END $t$;
DROP TRIGGER IF EXISTS journal_entry_insert_only ON journal_entry;
CREATE TRIGGER journal_entry_insert_only BEFORE UPDATE OR DELETE ON journal_entry FOR EACH ROW EXECUTE FUNCTION books_insert_only();
DROP TRIGGER IF EXISTS journal_line_insert_only ON journal_line;
CREATE TRIGGER journal_line_insert_only BEFORE UPDATE OR DELETE ON journal_line FOR EACH ROW EXECUTE FUNCTION books_insert_only();
DROP TRIGGER IF EXISTS party_item_insert_only ON party_item;
CREATE TRIGGER party_item_insert_only BEFORE UPDATE OR DELETE ON party_item FOR EACH ROW EXECUTE FUNCTION books_insert_only();
DROP TRIGGER IF EXISTS books_change_log_insert_only ON books_change_log;
CREATE TRIGGER books_change_log_insert_only BEFORE UPDATE OR DELETE ON books_change_log FOR EACH ROW EXECUTE FUNCTION books_insert_only();
DROP TRIGGER IF EXISTS books_payment_insert_only ON books_payment;
CREATE TRIGGER books_payment_insert_only BEFORE UPDATE OR DELETE ON books_payment FOR EACH ROW EXECUTE FUNCTION books_insert_only();

-- ── row-level security ────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE journal_entry    ENABLE ROW LEVEL SECURITY;  ALTER TABLE journal_entry    FORCE ROW LEVEL SECURITY;
ALTER TABLE journal_line     ENABLE ROW LEVEL SECURITY;  ALTER TABLE journal_line     FORCE ROW LEVEL SECURITY;
ALTER TABLE account_balance  ENABLE ROW LEVEL SECURITY;  ALTER TABLE account_balance  FORCE ROW LEVEL SECURITY;
ALTER TABLE party_item       ENABLE ROW LEVEL SECURITY;  ALTER TABLE party_item       FORCE ROW LEVEL SECURITY;
ALTER TABLE books_payment    ENABLE ROW LEVEL SECURITY;  ALTER TABLE books_payment    FORCE ROW LEVEL SECURITY;
ALTER TABLE books_outbox     ENABLE ROW LEVEL SECURITY;  ALTER TABLE books_outbox     FORCE ROW LEVEL SECURITY;
ALTER TABLE books_change_log ENABLE ROW LEVEL SECURITY;  ALTER TABLE books_change_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON journal_entry;
CREATE POLICY rls_entity ON journal_entry
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS rls_entity ON journal_line;
CREATE POLICY rls_entity ON journal_line
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS rls_entity ON account_balance;
CREATE POLICY rls_entity ON account_balance
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS rls_entity ON party_item;
CREATE POLICY rls_entity ON party_item
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS rls_entity ON books_payment;
CREATE POLICY rls_entity ON books_payment
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS rls_entity ON books_outbox;
CREATE POLICY rls_entity ON books_outbox
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
DROP POLICY IF EXISTS rls_entity ON books_change_log;
CREATE POLICY rls_entity ON books_change_log
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- the default grants (b48) give cb_app DELETE and UPDATE on every new table — take them back where the books are insert-only
REVOKE UPDATE, DELETE ON journal_entry, journal_line, party_item, books_payment, books_change_log FROM cb_app;
GRANT SELECT, INSERT ON journal_entry, journal_line, party_item, books_payment, books_change_log TO cb_app;
REVOKE DELETE ON account_balance, books_outbox FROM cb_app;
GRANT SELECT, INSERT, UPDATE ON account_balance, books_outbox TO cb_app;
GRANT USAGE, SELECT ON SEQUENCE journal_line_line_id_seq, party_item_item_id_seq, books_outbox_id_seq, books_change_log_id_seq TO cb_app;

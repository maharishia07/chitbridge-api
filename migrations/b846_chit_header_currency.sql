-- b846_chit_header_currency.sql — CUR-1 slice 3 (8 Nov 2026), D1: the chit header carries its own currency, fixed when the chit is written.
-- (The plan PM/CUR-1-PLAN-2026-11-08.md named this b845; CAT-264a took b845 first, so the CUR-1 files are b846 and b847. Nothing else changes.)
--
-- ⚠️ NOT RUN on production · Athi runs it (Supabase SQL editor, AS postgres), after SIT has run it. ADDITIVE: it changes no behaviour and no existing row; nothing reads
--    the new columns until slice 4. Safe to repeat (every statement is IF NOT EXISTS / DROP IF EXISTS first).
-- LOOKED AT (DISCIPLINES 4a): chit_detail.currency_code (the only currency column today: nullable, beside total_value numeric DEFAULT 0.00); the three places a chit states its
--    own money (business_json.currency, summary_json.currency_code, summary_json.money.currency_code); money.js (the one Money type, engines). This file adds no calculation.
-- WHAT IT IS. currency_code = what the chit's money is in; NULL means "not stated" and is NEVER defaulted (no 'INR'). currency_source says where the value came from, so every
--    backfilled value can be undone:
--      written by the api:      'stated' (the chit said it) | 'setup' (the sender's stamped Country setup, the ONE rule, plan 3.0)
--      written by the backfill: 'backfill_stated' | 'backfill_detail' | 'backfill_none' (no money) | 'backfill_review' (in chit_currency_review)
--      written by an owner resolving a review row: 'resolved'.      NULL = not yet processed (b847's batch picks these up).
--    The two CHECKs are added NOT VALID (no table scan under lock) and validated by b847 after the backfill.
-- chit_currency_review: the legacy list (a chit whose money cannot be told apart is listed, never defaulted). chit_currency_violation: b847a's counter (slice 8); created here so
--    slice 8 is a function change only. Both are RLS-closed per entity like every entity table (ENABLE + FORCE + the one policy); cb_app and cb_backup may READ only (REVOKE ALL then GRANT SELECT).
-- COST. ADD COLUMN with no default is a catalogue change, not a rewrite; the brief ACCESS EXCLUSIVE lock is bounded by lock_timeout (a failed run changed nothing).
-- ROLL BACK: RUN-2026-11-09-1-cur1-b846-ROLLBACK.sql (drops both tables, both constraints, both columns; safe: nothing reads them before slice 4).
-- CHECK (read-only): SELECT count(*) FROM information_schema.columns WHERE table_name = 'chit_header' AND column_name IN ('currency_code','currency_source');   Expect 2.
-- OWNER: routes/chits.js (writes currency_code and currency_source from slice 4); the backfill b847 and the owner's review resolution are the only other writers.

SET lock_timeout = '5s';

ALTER TABLE chit_header ADD COLUMN IF NOT EXISTS currency_code   varchar(3);
ALTER TABLE chit_header ADD COLUMN IF NOT EXISTS currency_source text;
ALTER TABLE chit_header DROP CONSTRAINT IF EXISTS chit_header_currency_shape;
ALTER TABLE chit_header ADD  CONSTRAINT chit_header_currency_shape
  CHECK (currency_code IS NULL OR currency_code ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE chit_header DROP CONSTRAINT IF EXISTS chit_header_currency_source_chk;
ALTER TABLE chit_header ADD  CONSTRAINT chit_header_currency_source_chk CHECK (
  (currency_source IS NULL)
  OR (currency_source IN ('stated','setup','backfill_stated','backfill_detail','resolved') AND currency_code IS NOT NULL)
  OR (currency_source IN ('backfill_none','backfill_review')                               AND currency_code IS NULL)) NOT VALID;

CREATE TABLE IF NOT EXISTS chit_currency_review (
  chit_id       uuid        NOT NULL,
  entity_id     uuid        NOT NULL,
  direction     varchar(10) NOT NULL,      -- chit_header's key is (chit_id, entity_id, direction): a sent and a received copy are listed separately
  reason        text        NOT NULL CHECK (reason IN ('stated_disagrees','detail_rows_disagree','detail_vs_stated',
                                                       'detail_partly_null','copies_disagree','money_without_currency')),
  stated_codes  text[],
  detail_codes  text[],
  found_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at   timestamptz,
  resolved_by   text,
  resolution    text,
  PRIMARY KEY (chit_id, entity_id, direction));
-- WHY: the owner's review screen lists one shop's unresolved rows newest first (entity_id leads for RLS); the primary key leads with chit_id so it cannot serve that read
CREATE INDEX IF NOT EXISTS chit_currency_review_entity_idx ON chit_currency_review (entity_id, found_at);

CREATE TABLE IF NOT EXISTS chit_currency_violation (
  id              bigserial   PRIMARY KEY,
  seen_at         timestamptz NOT NULL DEFAULT now(),
  entity_id       uuid        NOT NULL,
  chit_id         uuid        NOT NULL,
  kind            text        NOT NULL CHECK (kind IN ('detail_mismatch','money_without_currency','in_place_change')),
  detail_currency text,
  header_currency text);
-- WHY: slice 8's daily counter reads one shop's violations by time (entity_id leads for RLS); the bigserial key cannot serve that read
CREATE INDEX IF NOT EXISTS chit_currency_violation_entity_idx ON chit_currency_violation (entity_id, seen_at);

ALTER TABLE chit_currency_review    ENABLE ROW LEVEL SECURITY;  ALTER TABLE chit_currency_review    FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON chit_currency_review;
CREATE POLICY rls_entity ON chit_currency_review
  USING (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
ALTER TABLE chit_currency_violation ENABLE ROW LEVEL SECURITY;  ALTER TABLE chit_currency_violation FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON chit_currency_violation;
CREATE POLICY rls_entity ON chit_currency_violation
  USING (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- the schema's default privileges hand a new table to cb_app in full: take the write back, then give the read (writes arrive with the slices that need them)
REVOKE ALL ON chit_currency_review, chit_currency_violation FROM cb_app, cb_backup;
GRANT SELECT ON chit_currency_review, chit_currency_violation TO cb_app, cb_backup;   -- the owner's resolution and slice 8's definer functions write; the app reads

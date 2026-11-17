-- b391_fx_rates.sql — FX1 (2026-10-14): THE EXCHANGE RATES A SHOP USES — one row per rate the owner typed or imported (CSV), per day and currency pair.
--   A foreign bill posts at the rate of ITS day from this table; a period-end revaluation at the closing rate from it. A rate is EVIDENCE: never fetched from a
--   third party by default, never assumed; every entry that used one names it (journal_line.fx_rate_source · fx_rate_date, b392).
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Written offline, read, never executed. Safe to re-run (IF NOT EXISTS throughout;
--    the policy is dropped and created again).
--    Until it runs: GET /api/books/fx-rates answers ready:false WITH the sentence and the Rates screen greys "Add rate" with it; the writes answer 503
--    BOOKS_NOT_MIGRATED in words. A foreign bill keeps waiting on Waiting, named ("No USD rate for 14 Oct — add it"). Never a 500.
--
-- RLS: ENABLE + FORCE, the books' own entity policy (b272: entity_id = app.current_entity). cb_app gets SELECT and INSERT only — NO UPDATE, NO DELETE:
--    a rate an entry used stays readable for ever. A correction is a NEWER row for the same day and pair; the newest row is the day's rate (rateOn).
--
-- WHAT (chitbridge-api docs/FIELDS.md "fx_rate"):
--   rate_date   date     the day the rate is for
--   from_ccy    text     the foreign currency (ISO 4217, three letters) — USD
--   to_ccy      text     the shop's functional currency — INR
--   rate        numeric  how many to_ccy one from_ccy buys (83.25 = USD 1 is ₹83.25), > 0, at most 10 decimals
--   source      text     manual (typed) · import (a CSV the owner loaded) · official (the country's official rate, typed or imported — the pack's fx.official_name)
--   source_ref  text     the file name or the notification the owner quoted (≤ 120)
--   entered_by  uuid     who entered it
CREATE TABLE IF NOT EXISTS fx_rate (
  rate_id     bigserial PRIMARY KEY,
  entity_id   uuid NOT NULL,
  rate_date   date NOT NULL,
  from_ccy    text NOT NULL CHECK (from_ccy ~ '^[A-Z]{3}$'),
  to_ccy      text NOT NULL CHECK (to_ccy ~ '^[A-Z]{3}$'),
  rate        numeric(24,10) NOT NULL CHECK (rate > 0),
  source      text NOT NULL CHECK (source IN ('manual', 'import', 'official')),
  source_ref  text CHECK (source_ref IS NULL OR char_length(source_ref) <= 120),
  entered_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (from_ccy <> to_ccy)
);
CREATE INDEX IF NOT EXISTS fx_rate_lookup_idx ON fx_rate (entity_id, from_ccy, to_ccy, rate_date DESC, rate_id DESC);

ALTER TABLE fx_rate ENABLE ROW LEVEL SECURITY;
ALTER TABLE fx_rate FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON fx_rate;
CREATE POLICY rls_entity ON fx_rate
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

GRANT SELECT, INSERT ON fx_rate TO cb_app;
GRANT USAGE, SELECT ON SEQUENCE fx_rate_rate_id_seq TO cb_app;
COMMENT ON TABLE fx_rate IS 'FX1: an exchange rate the owner typed or imported, per day and pair; insert-only; the newest row for a day is that day''s rate';

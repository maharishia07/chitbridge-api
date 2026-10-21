-- b177 — "I have seen what this supplier can prove, and I accept it."
--
-- Athi, 2026-08-20: *"we just build a MECHANISM, not to build the rule as of now. When supplier is selected,
-- its trade ready can be showcased and ask for acceptance — that is all, enough now."*
--
-- ⭐⭐ THE MECHANISM WITHOUT THE RULE, AND THAT IS THE RIGHT ORDER. The rule — which standards a business
-- REQUIRES of a supplier — needs two decisions nobody has made yet (entity-wide or per line of business;
-- warning or block). The mechanism needs neither: show what they can prove, and record that a named person
-- looked at it and accepted. A requirement engine built on a guess would have to be unbuilt.
--
-- ⚠️⚠️ THE SNAPSHOT IS THE WHOLE POINT, AND WITHOUT IT THIS TABLE WOULD BE WORTHLESS. A row saying only
-- "Athi accepted Supplier X on 20 Aug" answers nothing six months later, when their ISO certificate has
-- expired and the question is whether it was valid WHEN THE DEAL WAS DONE. So the summary they showed at that
-- moment is stored WITH the acceptance — 5 verified, 7 of 7, none expiring — frozen.
--
-- ⭐ THAT IS THIS PLATFORM'S OWN HABIT. A chit freezes its terms at send; a seal freezes what was sealed. An
-- acceptance that pointed at live readiness would silently rewrite itself every time the supplier renewed or
-- let something lapse, and the record of a decision would stop matching the decision.
--
-- ⚠️ ACCEPTANCES ACCUMULATE — they are not updated. Accepting again is a NEW row, because "accepted twice, six
-- months apart" is a different fact from "accepted once". The latest is a query, not a column.
--
-- WITH ROW LEVEL SECURITY — this is the accepting entity's record of its own decision.

CREATE TABLE IF NOT EXISTS supplier_readiness_acceptance (
  acceptance_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WHO accepted, and about WHOM.
  entity_id       uuid NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  supplier_id     uuid NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,

  /**
   * ⚠️ WHAT THEY SAW, NOT WHAT IS TRUE NOW. resolveReadiness().summary at the moment of acceptance —
   * { total, met, verified, attested, documented, pending, expiring, expired, percent, ready }.
   */
  summary         jsonb NOT NULL,

  -- WHO in the business pressed it. A decision belongs to a person, not to a company.
  accepted_by     uuid REFERENCES identities(identity_id) ON DELETE SET NULL,
  accepted_at     timestamptz NOT NULL DEFAULT NOW(),
  note            text
);

CREATE INDEX IF NOT EXISTS sra_entity_supplier_idx
  ON supplier_readiness_acceptance (entity_id, supplier_id, accepted_at DESC);

ALTER TABLE supplier_readiness_acceptance ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_readiness_acceptance FORCE  ROW LEVEL SECURITY;

/**
 * ⚠️⚠️ THE CANONICAL PREDICATE, AND NOT THE ONE I WROTE TWICE THIS MORNING. b172 and b174 both named
 * `app.entity_id` — a setting nothing sets — so both policies denied everything, silently on the writer that
 * swallows errors. db/index.js sets `app.current_entity`, and NULLIF is what stops '' (a null entity) raising
 * 22P02. tests/rls-predicate.test.cjs fails the build if this is wrong again.
 */
DROP POLICY IF EXISTS sra_tenant ON supplier_readiness_acceptance;
CREATE POLICY sra_tenant ON supplier_readiness_acceptance
  USING      (entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid)
  WITH CHECK (entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid);

/* ⚠️ NO UPDATE OR DELETE POLICY, DELIBERATELY. An acceptance that can be quietly rewritten is not evidence —
   the same reasoning b172's access_events rests on. A change of mind is a new row. */

-- One result set — the editor shows only the last.
SELECT 'b177' AS report,
       (SELECT count(*) FROM information_schema.columns WHERE table_name = 'supplier_readiness_acceptance') AS columns_created,
       (SELECT count(*) FROM pg_policies WHERE tablename = 'supplier_readiness_acceptance')                 AS policies,
       (SELECT count(*) FROM supplier_readiness_acceptance)                                                 AS rows_present;

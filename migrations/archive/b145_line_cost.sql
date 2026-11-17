-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b145 — COST AND MARGIN. Private, and WRITE-WITHOUT-READ.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-12: *"money cannot be seen by everyone, the cost accumulates here, not the difference."*
-- Then, on being shown the trap: **write-without-read confirmed.**
--
-- ── ⚠️ THE TRAP THAT SHAPED THIS TABLE ──────────────────────────────────────────────────────────────────────────
-- The obvious build is "hide the margin field". It does not work. A picker who can see the goods cost AND the
-- price the customer was quoted derives the margin himself in his head — the number is not hidden, only unlabelled.
-- So the permission cannot be about a FIELD; it has to be about READING AT ALL.
--
-- Murugan records his own 80 minutes and never sees the accumulated total, the goods cost, or the difference.
-- He can always read back HIS OWN rows — a person who cannot check what they just entered will enter it wrong,
-- and blind data entry is worse than none.
--
-- ── ⚠️ A NEW AXIS: WITHIN-ENTITY PERMISSION ─────────────────────────────────────────────────────────────────────
-- Every isolation rule until now has been ENTITY-level (RLS on entity_id) — all actors of an entity see whatever
-- the entity sees. This is the first thing an entity holds that some of its OWN people may not read. RLS cannot
-- express it, because RLS scopes by entity and these actors ARE the entity. So the gate lives in the API and is
-- stated here so nobody later assumes RLS was doing it.
--
-- DEFAULT: the entity login sees money; actors do not. For a one-person business with helpers that is the right
-- default — Athi is the entity, Murugan is an actor. `identities.can_see_costs` opens it per person.
--
-- ── ⚠️ COSTS ATTACH AT TWO LEVELS, DELIBERATELY ─────────────────────────────────────────────────────────────────
-- Murugan's packing time attaches to a LINE. The ₹250 auto fare attaches to the whole CHIT — it is one trip, and
-- splitting it across lines would invent an allocation nobody agreed. line_id NULL means chit-level.
--
-- ⚠️ MARGIN IS NEVER STORED. It is invoiced minus costs, computed on read. A stored margin is a second answer that
-- goes stale the moment a cost or an amendment lands.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS chit_line_cost (
  cost_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chit_id       uuid NOT NULL,
  entity_id     uuid NOT NULL,
  -- NULL = a cost against the WHOLE chit (transport, a permit) rather than one line.
  line_id       uuid,

  kind          text NOT NULL DEFAULT 'other'
                CHECK (kind IN ('goods', 'labour', 'transport', 'other')),
  -- ⚠️ SIGNED, like a delivery. A negative row corrects an earlier one; nothing is edited or deleted.
  amount        numeric(18,2) NOT NULL,
  currency      text NOT NULL DEFAULT 'INR',

  -- Labour is entered as minutes × rate because that is how it is known ("80 min at ₹150/hr"), and keeping both
  -- means the rate can be checked later instead of only the product.
  minutes       integer,
  rate_per_hour numeric(18,2),

  note          text,

  -- ⚠️ WHO ENTERED IT — this is what makes write-without-read possible at all. A worker reads back rows WHERE
  -- recorded_by_actor_id = themselves; everything else needs the capability.
  recorded_by_actor_id   uuid,
  recorded_by_actor_name text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chit_line_cost_chit ON chit_line_cost (entity_id, chit_id, line_id);
CREATE INDEX IF NOT EXISTS chit_line_cost_who  ON chit_line_cost (entity_id, recorded_by_actor_id, created_at);

ALTER TABLE chit_line_cost ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_line_cost FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS chit_line_cost_isolation ON chit_line_cost;
CREATE POLICY chit_line_cost_isolation ON chit_line_cost
  USING       (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK  (entity_id = current_setting('app.current_entity', true)::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON chit_line_cost TO cb_app;

-- ── the per-person grant ────────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ DEFAULT FALSE, on purpose. A new co-assist starts unable to read money and is opened up deliberately. The
-- opposite default would leak the buying price to the next person hired, silently, on day one.
ALTER TABLE identities ADD COLUMN IF NOT EXISTS can_see_costs boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN identities.can_see_costs IS
  'b145 — may this ACTOR read cost totals and margin? Default false. The entity login always may. This is the first within-entity permission in CB: RLS cannot express it, because these actors ARE the entity, so the gate lives in the API.';

COMMENT ON TABLE chit_line_cost IS
  'b145 — costs, PRIVATE to the entity and gated WITHIN it. Anyone may record; only the entity login or an actor with can_see_costs may read totals or margin. A worker always reads back their own rows. line_id NULL = a whole-chit cost. Margin is computed, never stored.';

DO $$
BEGIN
  RAISE NOTICE 'b145: chit_line_cost created WITH RLS (FORCE) + identities.can_see_costs (default false). Write-without-read is enforced in the API, not by RLS — see the table comment.';
END $$;

-- b172 — an audit trail for ACCESS changes.
--
-- IAM-SPEC.md §29. There is currently NO record of who changed a co-assist's hat, when, or from what.
-- `changed_by` exists in this database exactly once, on catalogue item versions.
--
-- ⚠️⚠️ THAT IS THE HOLE A BUYER FINDS FIRST. The product's pitch is provenance — a governed rail where every
-- record carries who did what. An IAM screen that tells an employee "request your manager to modify your
-- access" and then keeps no record that the manager did is the one place the pitch does not hold. It is also
-- the cheapest possible thing to add now and an expensive one to backfill, because the events that were never
-- written cannot be recovered.
--
-- ⚠️ WHAT IT DELIBERATELY DOES NOT DO: it is not a general activity log. It records changes to ACCESS —
-- the hat, the cost visibility, the break status, creation and removal. Chit activity has its own trail. A
-- table that logs everything is a table nobody reads.
--
-- WITH ROW LEVEL SECURITY — this is entity data, and the default for entity data is RLS on (b1).

CREATE TABLE IF NOT EXISTS access_events (
  event_id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- WHOSE business this concerns. Every read is scoped by this.
  entity_id            uuid NOT NULL REFERENCES identities(identity_id),

  -- WHOSE access changed.
  subject_identity_id  uuid NOT NULL REFERENCES identities(identity_id),

  -- WHAT changed. Closed set, deliberately: an open text column becomes unqueryable within a month.
  action               text NOT NULL CHECK (action IN
                         ('created','hat_changed','costs_changed','break_changed','removed','reactivated')),

  -- ⚠️ BEFORE AND AFTER, NOT JUST AFTER. "Ravi is now view_only" does not answer "what was he before", which
  -- is the question actually asked when something has gone wrong.
  before_value         jsonb,
  after_value          jsonb,

  -- WHO did it. Null only for a system action, and there should be very few of those.
  changed_by           uuid REFERENCES identities(identity_id),

  -- ⚠️ A REASON, OPTIONAL. Athi's employee tab says "request your manager to modify" — when the manager does,
  -- the request is the reason, and a trail that carries WHY is worth more than one that carries only WHAT.
  reason               text,

  at                   timestamptz NOT NULL DEFAULT now()
);

-- The read this table exists for: "show me everything that happened to this person's access".
CREATE INDEX IF NOT EXISTS access_events_subject_idx ON access_events (subject_identity_id, at DESC);
-- And the entity-wide one, which is what an auditor opens.
CREATE INDEX IF NOT EXISTS access_events_entity_idx  ON access_events (entity_id, at DESC);

ALTER TABLE access_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS access_events_isolation ON access_events;
CREATE POLICY access_events_isolation ON access_events
  USING (entity_id = current_setting('app.entity_id', true)::uuid)
  WITH CHECK (entity_id = current_setting('app.entity_id', true)::uuid);

-- ⚠️ NO UPDATE OR DELETE POLICY, ON PURPOSE. An audit trail that can be edited is not an audit trail. Nothing
-- in the application should ever amend one of these rows; if a row is wrong, the correction is another row.

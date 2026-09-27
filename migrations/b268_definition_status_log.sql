-- b268: DEFINITION STATUS LOG — who moved a definition through draft → approved → live → paused → retired,
-- and when. Additive only; nothing existing changes shape.
--
-- Athi, on Offer Lab's saved-offers screen and the till's own maintenance row: "there the raw information
-- should be visible including who approved the offer or made it live." Checked first: nothing in the system
-- recorded this. `definition.created_by` is set once, at creation, by the b160 migration's own design; a
-- later status change is a bare `UPDATE definition SET status = ...`, `updated_at` only, no actor column at
-- all. Adding one column to `definition` (`status_changed_by`) would only ever remember the MOST RECENT
-- transition — "who approved" is overwritten the moment the same offer goes live, which is exactly the two
-- facts Athi asked for by name.
--
-- So: append-only, one row per transition, patterned on `definition_version` (b160) for the identical reason
-- that table is append-only rather than overwritten — "nothing is ever overwritten and nothing is ever
-- deleted" is already this schema's own rule for its history; a status log is that same rule applied to
-- status instead of rules.
--
-- Not folded into `definition_version`: a version exists only when RULES change (b160's own comment: "a new
-- version only when the rules change... renaming or retiring is not a change to what it MEANS"), so most
-- status transitions (approve, go live, pause) mint no version at all and would have nowhere to attach a row.
--
-- Generic across every `kind` this table already serves (offer, category, tax, …), not offer-specific — the
-- same non-decision `definition`/`definition_version` already made.
--
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS definition_status_log (
  id             bigserial PRIMARY KEY,
  definition_id  uuid NOT NULL,
  entity_id      uuid NOT NULL,        -- denormalised, same as definition_version, so RLS isolates this table alone
  status         text NOT NULL,        -- the status this row moved INTO — 'approved' | 'live' | 'paused' | 'retired' | …
  changed_by     uuid,                 -- identities.identity_id; null if the actor could not be resolved
  changed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS definition_status_log_def_idx ON definition_status_log (definition_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS definition_status_log_ent_idx ON definition_status_log (entity_id, changed_at DESC);

ALTER TABLE definition_status_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE definition_status_log FORCE ROW LEVEL SECURITY;
CREATE POLICY rls_entity ON definition_status_log
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);
GRANT SELECT, INSERT ON definition_status_log TO cb_app;

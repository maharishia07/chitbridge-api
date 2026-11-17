-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b132 — FOLDER RULES.  ⭐ THE ONLY SQL FROM THE 2026-08-10 AUTONOMOUS RUN. Run this one file; nothing else waits.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-10: *"when we create a folder, inside we may have to have options to set the rules and whatever it
-- is"* — and separately, *"if you have to create any sql run, keep all together."*
--
-- Everything else built in that run (folder metrics, the counterparty scorecard, the shared select/measure/match
-- helpers, the money fix) is READ-ONLY and already live. This table is the single thing that needed schema.
--
-- ── ⚠️ SAFE TO RUN, AND INERT UNTIL A RULE IS CREATED ───────────────────────────────────────────────────────────
-- It adds one table and nothing else. No column is altered, no data is touched, no existing behaviour changes: with
-- zero rows, the evaluation hook does nothing at all. The API self-heals if this has NOT been run (42P01 → "not
-- migrated"), so the app works either way and says which it is.
--
-- ── ⚠️ WITH RLS, LIKE EVERY OTHER ENTITY-DATA TABLE ─────────────────────────────────────────────────────────────
-- A folder rule is as private as the folder it fills. FORCE ROW LEVEL SECURITY applies to the table owner too, so
-- even cb_app cannot read across tenants without app.current_entity set — which is the same floor `folder` (b64)
-- and `capture` (b104) already stand on.
--
-- ── ⚠️ A RULE ONLY FILES. IT MAY NOT MUTATE. ────────────────────────────────────────────────────────────────────
-- There is deliberately no `then` column. The only action is "file into this folder", which is a VIEW operation on
-- your own copy of a chit and therefore safe to automate. A rule that could change a status, a value or a
-- counterparty would be automation editing an obligation, and that belongs behind a human every time.

CREATE TABLE IF NOT EXISTS folder_rule (
  rule_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL,
  folder_id       uuid NOT NULL REFERENCES folder(folder_id) ON DELETE CASCADE,
  name            text,
  -- The condition, in the SAME vocabulary the list screen speaks (lib/match.js KEYS). Validated in the app before
  -- it is stored: an unknown key is REFUSED, never ignored — a rule that silently matches nothing looks enabled.
  "when"          jsonb NOT NULL,
  enabled         boolean NOT NULL DEFAULT true,
  -- Order + stop, exactly as Gmail/Outlook: overlapping rules are inevitable, and "which one won" must be
  -- answerable by reading down the list rather than by guessing.
  sort            integer NOT NULL DEFAULT 0,
  stop_processing boolean NOT NULL DEFAULT false,
  -- Observability, so a rule that quietly stopped matching is visible rather than assumed to be working.
  last_matched_at timestamptz,
  match_count     bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS folder_rule_entity_idx ON folder_rule (entity_id, sort, created_at);
CREATE INDEX IF NOT EXISTS folder_rule_folder_idx ON folder_rule (folder_id);

ALTER TABLE folder_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE folder_rule FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS folder_rule_isolation ON folder_rule;
CREATE POLICY folder_rule_isolation ON folder_rule
  USING       (entity_id = current_setting('app.current_entity', true)::uuid)
  WITH CHECK  (entity_id = current_setting('app.current_entity', true)::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON folder_rule TO cb_app;

COMMENT ON TABLE folder_rule IS
  'b132 — condition -> file into a folder. Same condition vocabulary as the list filter (lib/match.js). Files only; never mutates a chit. WITH RLS (FORCE).';

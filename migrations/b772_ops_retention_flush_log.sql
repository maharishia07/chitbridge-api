-- b772_ops_retention_flush_log.sql — K-DB / DB-21 + PM-16 (21 Oct 2026): every retention flush ATTEMPT is an event, in the ops schema.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF
--    EXISTS then CREATE). Touches no existing rows.
--
-- WHY. lib/retention.js planRetirement({ commit: true }) is the one flush door. DB-21: nothing flushes without an archive receipt — the
--    commit is refused (BLOCKED) unless the caller hands one (where the archive lives is Athi's call; NO table here holds archived copies,
--    the database is at the Free-plan quota). PM-16: a missing row must be explainable, so every commit attempt (refused or not) is one row
--    here: when, what mode, why, how many candidates, how many deleted (0 until a commit path is wired), the receipt, the guardrail.
-- OWNER: lib/retention.js (planRetirement, the one flush door)
-- RLS: ops.retention_flush_log is ENABLE + FORCE ROW LEVEL SECURITY. Closed to cb_app (no table grant at all) and to PUBLIC; cb_ops reads it
--    (SELECT, policy retention_flush_log_ops_read). The ONE writer is ops.f_retention_flush_event(...), SECURITY DEFINER (owner postgres),
--    insert-only, which cb_app may EXECUTE — the same shape as ops.f_books_enabled (b272): the app gets one narrow door, never the table.
--    The owner's policy (retention_flush_log_owner) follows schema_migrations_owner, so the definer passes FORCE RLS.

CREATE TABLE IF NOT EXISTS ops.retention_flush_log (
  flush_id    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  at          timestamptz NOT NULL DEFAULT now(),
  mode        text NOT NULL CHECK (mode IN ('BLOCKED', 'commit-not-wired', 'committed')),
  reason      text,
  candidates  integer NOT NULL CHECK (candidates >= 0),
  deleted     integer NOT NULL DEFAULT 0 CHECK (deleted >= 0),
  receipt     jsonb CHECK (receipt IS NULL OR jsonb_typeof(receipt) = 'object'),
  guardrail   jsonb,
  run_by      text NOT NULL DEFAULT session_user
);
COMMENT ON TABLE ops.retention_flush_log IS
  'DB-21/PM-16 b772: one row per retention commit attempt (lib/retention.js planRetirement). Written only by ops.f_retention_flush_event.';

ALTER TABLE ops.retention_flush_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.retention_flush_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS retention_flush_log_owner ON ops.retention_flush_log;
CREATE POLICY retention_flush_log_owner ON ops.retention_flush_log
  USING (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text)) WITH CHECK (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text));
DROP POLICY IF EXISTS retention_flush_log_ops_read ON ops.retention_flush_log;
CREATE POLICY retention_flush_log_ops_read ON ops.retention_flush_log FOR SELECT TO cb_ops USING (true);

REVOKE ALL ON TABLE ops.retention_flush_log FROM PUBLIC;
REVOKE ALL ON TABLE ops.retention_flush_log FROM cb_app;
GRANT SELECT ON TABLE ops.retention_flush_log TO cb_ops;

CREATE OR REPLACE FUNCTION ops.f_retention_flush_event(p_mode text, p_reason text, p_candidates integer, p_deleted integer,
                                                       p_receipt jsonb, p_guardrail jsonb) RETURNS uuid
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'ops'
    AS $$
  INSERT INTO ops.retention_flush_log (mode, reason, candidates, deleted, receipt, guardrail, run_by)
  VALUES (p_mode, p_reason, p_candidates, coalesce(p_deleted, 0), p_receipt, p_guardrail, session_user)
  RETURNING flush_id
$$;
REVOKE ALL ON FUNCTION ops.f_retention_flush_event(text, text, integer, integer, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.f_retention_flush_event(text, text, integer, integer, jsonb, jsonb) TO cb_app;
GRANT EXECUTE ON FUNCTION ops.f_retention_flush_event(text, text, integer, integer, jsonb, jsonb) TO cb_ops;

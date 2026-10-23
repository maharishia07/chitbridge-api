-- b780_idempotency_key_expiry.sql — DB-82 (23 Oct 2026): idempotency_key gets a TABLE-WIDE expiry sweep (the file name avoids the word the migration chain reserves for owner-run data files).
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (CREATE OR REPLACE, DROP POLICY IF EXISTS then
--    CREATE). Touches no existing rows: it only adds a door that the api's own timer calls (middleware/idempotency.js purgeExpired).
--
-- WHY. A key was only swept when THAT shop next sent the same key (begin() reclaims an expired row) or, for token answers, when that shop
--    recorded its next token answer (api #341). A shop that never orders again kept its last customer-token answer — a signed-in session —
--    for ever. The purge deletes every expired row, every shop, on a schedule.
-- EXPIRY = the SAME three terms middleware/idempotency.js begin() reads (the api passes its own numbers in, so there is one set):
--    created_at older than the replay window · an in_progress row older than the stale minutes · a recorded answer carrying a `token`
--    older than the token-replay minutes (api #341, 15). Bounded: at most p_limit rows a call, oldest first.
-- RLS: idempotency_key is already ENABLE + FORCE with rls_entity (b109). The function is SECURITY DEFINER (the one cross-shop door, the same
--    shape as ops.f_books_enabled b272); the extra owner policy follows schema_migrations_owner so the definer passes FORCE RLS even where the
--    owner has no BYPASSRLS. cb_app still sees only its own shop's rows; EXECUTE goes to cb_app only, never PUBLIC.

DROP POLICY IF EXISTS idempotency_key_owner ON public.idempotency_key;
CREATE POLICY idempotency_key_owner ON public.idempotency_key
  USING (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text)) WITH CHECK (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text));

CREATE OR REPLACE FUNCTION ops.f_idempotency_purge(p_window_hours integer, p_stale_minutes integer, p_token_minutes integer, p_limit integer DEFAULT 5000)
  RETURNS integer
  LANGUAGE sql SECURITY DEFINER
  SET search_path TO 'public'
  AS $$
  WITH gone AS (
    DELETE FROM idempotency_key k
     WHERE k.ctid IN (
       SELECT i.ctid FROM idempotency_key i
        WHERE i.created_at < now() - make_interval(hours => p_window_hours)
           OR (i.state = 'in_progress' AND i.created_at < now() - make_interval(mins => p_stale_minutes))
           OR (i.response ? 'token' AND i.created_at < now() - make_interval(mins => p_token_minutes))
        ORDER BY i.created_at
        LIMIT greatest(p_limit, 1))
    RETURNING 1)
  SELECT count(*)::integer FROM gone
$$;
REVOKE ALL ON FUNCTION ops.f_idempotency_purge(integer, integer, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.f_idempotency_purge(integer, integer, integer, integer) TO cb_app;

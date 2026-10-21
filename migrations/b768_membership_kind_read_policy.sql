-- b768_membership_kind_read_policy.sql — DB-3 (21 Oct 2026): membership_kind has RLS ON and NO policy in production.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (DROP POLICY IF EXISTS, then CREATE). Touches no rows.
--
-- WHY. b297 made membership_kind "platform-wide, read-only to the app" and GRANTed SELECT to cb_app, but enabled RLS without a policy, so
--    cb_app sees 0 rows. No api code reads the table today (lib/memberships.js only mirrors its kinds in code; the memberships FK check runs
--    as the table owner), so nothing returns wrong data now; the first reader would get an empty dictionary. Found by the DB-3 replay
--    (tests/rls-fresh-db: "every table with RLS on has a policy").
-- RLS: already ENABLED in production (not repeated here); one SELECT-only policy, same shape as catalogue_source read_all (USING (true)). No INSERT/UPDATE/DELETE policy and the
--    privileges stay revoked (b297), so the app still cannot write the dictionary.

DROP POLICY IF EXISTS membership_kind_read_all ON membership_kind;
CREATE POLICY membership_kind_read_all ON membership_kind FOR SELECT USING (true);

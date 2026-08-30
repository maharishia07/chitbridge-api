-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b191 — tighten chit_reads from "anyone" to "the actor whose row it is".
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- b190 gave this table a PERMISSIVE policy, which restored its original documented design (b61: "a per-actor
-- carve-out, not entity-RLS-scoped"). That was the safe move at the time because the tighter version depends on
-- `app.current_actor` being populated on every path that touches the table, and that was unverified.
--
-- ⭐ IT IS NOW VERIFIED, and the answer is clean. Exactly two paths touch chit_reads, both in routes/chits.js:
--
--   GET /unread          returns early unless identity_type = 'actor', then joins on cr.actor_id = identity_id
--   GET /:chit_id        inserts only when identity_type = 'actor', with the same identity_id
--
-- and `middleware/auth.js` calls `runWithActor(req.identity.identity_id)` at the single point where auth hands
-- control on — so `app.current_actor` holds EXACTLY the value both paths use. Nothing else reads or writes the
-- table: no job, no webhook, no migration.
--
-- ⚠️ WHY BOTHER, given the table holds no business content. Defence in depth: without this, the policy permits
-- any actor to read which chits any other actor has opened. The app never queries that way — but "the app never
-- does" is not a control, and this is the cheapest possible one.
--
-- ⚠️ NOT FORCED. Migrations run as the owner and must keep working; FORCE would apply the policy to them too.
-- ⚠️ NULLIF-GUARDED, per b181. A bare ''::uuid raises when the setting is absent (jobs, tests, migrations) —
-- NULL simply matches nothing, which is the correct answer for a caller with no actor.
--
-- Safe to re-run. If /unread ever starts reporting everything as unread, this is the first thing to revert:
--   DROP POLICY IF EXISTS chit_reads_own ON chit_reads;
--   CREATE POLICY chit_reads_all ON chit_reads USING (true) WITH CHECK (true);

ALTER TABLE chit_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chit_reads_all ON chit_reads;
DROP POLICY IF EXISTS chit_reads_own ON chit_reads;
CREATE POLICY chit_reads_own ON chit_reads
  USING      (actor_id = NULLIF(current_setting('app.current_actor', true), '')::uuid)
  WITH CHECK (actor_id = NULLIF(current_setting('app.current_actor', true), '')::uuid);

-- ── what it looks like now — ONE result set ────────────────────────────────────────────────────────────────────
SELECT 'chit_reads'                                                        AS table_name,
       (SELECT count(*) FROM pg_policy p
         WHERE p.polrelid = 'chit_reads'::regclass)                        AS policies,
       (SELECT string_agg(p.polname, ', ') FROM pg_policy p
         WHERE p.polrelid = 'chit_reads'::regclass)                        AS policy_names,
       (SELECT count(*) FROM chit_reads)                                   AS rows_visible_to_owner,
       'read-tracking should still clear unread after opening a chit'      AS check_this;

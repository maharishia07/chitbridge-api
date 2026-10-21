-- b175 — two RLS policies name a setting nothing ever sets. One of them has been silently discarding an audit
-- trail since b172 was run.
--
-- ⚠️⚠️ WHAT IS WRONG. This codebase sets exactly one GUC for tenant isolation, in db/index.js:
--
--     withEntity(entityId, fn)  →  SELECT set_config('app.current_entity', $1, true)
--
-- and every policy in the baseline reads it in the same shape:
--
--     entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid
--
-- b172 (access_events) and b174 (identity_documents) instead read `app.entity_id` — a name nothing anywhere
-- sets. current_setting on an unset GUC with missing_ok=true returns NULL, NULL::uuid is NULL, and
-- `entity_id = NULL` is never true. So both policies deny everything, always, to everyone.
--
-- ⚠️⚠️ AND ON access_events THE FAILURE IS SILENT, WHICH IS THE REAL DAMAGE. lib/access-events.js swallows
-- every error deliberately — recording a change must never be the reason a change fails. Combine a writer that
-- cannot fail loudly with a policy that refuses every insert and you get an audit trail that reports success
-- and stores nothing. Confirmed live on 2026-08-20: an access change returned 200 and
-- GET /actors/access-events returned []. Every access change since b172 was applied is unrecorded and
-- unrecoverable — the events were never written, so there is nothing to backfill.
--
-- ⭐ I WROTE THE WARNING FOR THIS EXACT TRAP AND THEN WALKED INTO IT. b173 says: *"A writer that cannot fail
-- loudly must never be given something it will fail at."* That was about a CHECK constraint. The policy was
-- the same class of hazard sitting one line above it, and I did not look.
--
-- ⚠️ NULLIF IS NOT DECORATION. withEntity passes '' when entityId is null, and ''::uuid raises 22P02 rather
-- than yielding NULL — so the naive form turns a missing tenant into a 500 instead of an empty result. The
-- baseline shape handles it; copying the baseline shape exactly is the point.

-- ── access_events (b172) ────────────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS access_events_isolation ON access_events;
CREATE POLICY access_events_isolation ON access_events
  USING      (entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid)
  WITH CHECK (entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid);

-- ── identity_documents (b174) ───────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS idoc_tenant ON identity_documents;
CREATE POLICY idoc_tenant ON identity_documents
  USING      (entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid)
  WITH CHECK (entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid);

-- Proof, as ONE result set — the editor shows only the last. Every row must read app.current_entity.
SELECT 'b175' AS report,
       tablename,
       policyname,
       CASE WHEN qual LIKE '%app.current_entity%' THEN 'OK — canonical'
            WHEN qual LIKE '%app.entity_id%'     THEN 'STILL WRONG'
            ELSE 'unknown predicate' END AS verdict
  FROM pg_policies
 WHERE tablename IN ('access_events', 'identity_documents')
 ORDER BY tablename, policyname;

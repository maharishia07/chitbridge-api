-- b774_definition_name_unique_folded.sql — K-DB / DB-44 (21 Oct 2026): one definition per shop, kind and name, ignoring case and spaces.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (IF NOT EXISTS). Touches no rows. One
--    transaction: it first COUNTS the groups that would break the index and stops with the number if any (READ-2026-10-21-2 found 0 of
--    163 definitions with the parent included; this counts without it, see below), so a failed build cannot leave a half-made index.
--
-- WHY (and why not "per parent"). Today definition has UNIQUE (entity_id, kind, name) (definition_entity_id_kind_name_key) — exact
--    spelling only, so 'Dairy' and 'dairy ' sit side by side; lib/categories.js already folds names to lower case before it looks, the
--    database did not. DB-44 asked for (entity_id, kind, parent, name). The parent is NOT a column of definition: it lives in the
--    current version's rules->>'parent' (definition_version, another table, and it changes with a new version), and an index cannot
--    reach across tables. A trigger could, but it would add a second place that decides "same name", and the old exact key already
--    refuses the same name under two parents (stricter than per-parent), so adding the parent dimension would only weaken it. The honest,
--    enforceable form is therefore the columns that exist, with the name folded the way READ-2 folded it: lower(btrim(name)).
--    The old exact key stays (dropping a working guard is not this file's job).
--    kind 'testcase' is left out (the test board makes those per shop; READ-2 excluded them too).
-- Plain CREATE UNIQUE INDEX, not CONCURRENTLY, on purpose: definition is a few hundred rows after the test purge, the build takes
--    milliseconds, and CONCURRENTLY cannot sit in a transaction with the count above (a failed one leaves an INVALID index). So this file
--    does not need to run alone.
-- The code is ready before it runs: routes/definitions.js answers 23505 with 409 "Name taken", and lib/categories.js folds the name first.
-- RLS: unchanged (an index is not a policy; definition keeps FORCE RLS and its entity policies).

BEGIN;
DO $$
DECLARE groups integer;
BEGIN
  SELECT count(*) INTO groups FROM (
    SELECT 1 FROM definition WHERE kind <> 'testcase'
     GROUP BY entity_id, kind, lower(btrim(name)) HAVING count(*) > 1) g;
  IF groups > 0 THEN
    RAISE EXCEPTION 'b774 stopped: % shop/kind/name groups differ only by case or spaces. Run READ-2026-10-21-2 (or group by entity_id, kind, lower(btrim(name))) and pick which copy survives first.', groups;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS definition_entity_kind_name_folded_uq
  ON definition (entity_id, kind, lower(btrim(name))) WHERE kind <> 'testcase';
COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b232 — PUT EVERYONE ON 'test'. b230/b231 left them on 'free', which now means the opposite of what it did.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"currently all the entities are set is test plan so all the access is unlimited."*
--
-- ⚠️⚠️ B231 DID NOT DO THAT, AND THE BUG IS IN MY PREDICATE:
--
--     UPDATE identities SET plan = 'test'
--      WHERE plan IS NULL OR plan NOT IN ('test','free','silver','gold','platinum');
--
-- 'free' is IN that list, so the 2,502 rows sitting on 'free' were left exactly where they were. Only the
-- handful on 'enterprise' moved. Verified after b231: free 2502 · test 2.
--
-- ── ⭐ AND IT IS NOT COSMETIC, BECAUSE 'free' CHANGED MEANING AN HOUR AGO ───────────────────────────────────────
--
-- Before b230, 'free' was a column default nobody had ever written — it meant "no plan assigned".
-- After b230, 'free' is a REAL, SELLABLE, CAPPED tier (Athi: *"free plan should have limits, test entities do
-- not have"*), whose caps are deliberately unset.
--
-- ⚠️ So leaving every entity on 'free' says: every shop on the platform is on a limited commercial tier whose
--    limits nobody has decided. That is the worst of the three states lib/plans.js distinguishes — quotaOf()
--    would answer `{state:'unset'}` for all of them, and any enforcement built later must refuse to act on it.
--    'test' says the true thing: not for sale, no terms, nothing enforced.
--
-- ⭐ AFTERWARDS 'free' MEANS SOMETHING AGAIN. The day a shop is genuinely put on the free tier, they are the
--    only ones on it, and that is visible in one column.
--
-- ⚠️ Writes first, no exploratory SELECT before them — b161/b162 were run and applied nothing because they
--    opened with one. Supabase → SQL Editor → SELECT ALL → Run.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ⚠️ EVERY entity and actor, not just entities: identities holds all identity_types and the column defaults for
--    all of them, so an actor left on 'free' is the same ambiguity one row down.
UPDATE identities SET plan = 'test' WHERE plan IS DISTINCT FROM 'test';

COMMIT;

-- ── VERIFY ─────────────────────────────────────────────────────────────────────────────────────────────────────
SELECT plan, count(*) AS rows FROM identities GROUP BY 1 ORDER BY 2 DESC;
-- ⭐ EXPECTED: one row — test. Nothing else, until somebody is actually sold something.

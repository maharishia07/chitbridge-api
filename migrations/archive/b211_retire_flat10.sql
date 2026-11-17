-- b211 · RETIRE THE UNSCOPED "Flat 10%" OFFER IN tallytest
-- ============================================================================================================
-- Athi, 2026-09-09: "retire the flat 10% offer".
--
-- WHY. Pricing a real basket showed 7 offers live, not the 5 from b209. An older "Flat 10%" carries NO
-- applies_to, so it reaches every line in every basket and stacked on top of the others — the demo basket fell
-- 23% and it was impossible to see which offer had done what. Nothing is broken: stacking is explicit and the
-- engine is obeying. It is simply not what you want on a screen you are showing someone.
--
-- ⚠️ RETIRED, NOT DELETED — the same thing the application's own DELETE does (routes/definitions.js sets
-- status='retired' and says "not deleted; chits that cite it stay explainable"). A bill already stamped with
-- this offer must still be able to explain its own arithmetic years later. Deleting the row would leave those
-- chits citing an id that resolves to nothing, which is how a discount becomes unexplainable at audit.
--
-- ⚠️ REVERSIBLE. Set status back to 'live' and it returns, rules and version untouched.
--
-- ⭐ WITH RLS. definition is ENABLE + FORCE row level security (b160) isolated on app.current_entity. The
-- context is set below, so this can only ever touch THIS shop's offers — with the wrong id it would update
-- nothing rather than retire somebody else's discount.
--
-- Supabase -> SQL Editor -> paste -> Run. Step 1 only looks.
-- ============================================================================================================

SELECT set_config('app.current_entity', 'c2837d52-47f2-47e2-9fcd-b98c68a49e45', false);

-- ── 1 · EVERY OFFER THIS SHOP HAS. Expect 7 live. Read the `rules` column: the one to retire is the row with no
--        "applies_to" in it — that is what makes it reach every line.
SELECT d.name, d.sub_kind, d.status, v.rules,
       (v.rules ? 'applies_to') AS is_scoped
FROM definition d
LEFT JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
WHERE d.entity_id = 'c2837d52-47f2-47e2-9fcd-b98c68a49e45' AND d.kind = 'offer'
ORDER BY d.status, d.name;

-- ── 2 · RETIRE IT. By NAME, and only while it is live — so running this twice changes nothing the second time.
BEGIN;

WITH gone AS (
  UPDATE definition
     SET status = 'retired', updated_at = now()
   WHERE entity_id = 'c2837d52-47f2-47e2-9fcd-b98c68a49e45'
     AND kind = 'offer'
     AND status = 'live'
     AND name = 'Flat 10%'
  RETURNING name
)
SELECT count(*) AS retired, string_agg(name, ', ') AS which FROM gone;

-- ⚠️ Expect retired = 1, which = "Flat 10%".
--    0 → the name differs; look at what step 1 printed and change the name above.
--    2+ → there is more than one; check that is what you meant before COMMIT.
COMMIT;

-- ── 3 · PROVE IT. Expect 5 live (the b209 offers) and "Flat 10%" listed as retired.
SELECT d.name, d.sub_kind, d.status
FROM definition d
WHERE d.entity_id = 'c2837d52-47f2-47e2-9fcd-b98c68a49e45' AND d.kind = 'offer'
ORDER BY d.status, d.name;

-- ── AFTERWARDS: nothing to restart. liveOffers reads status='live' on every request, so the counter drops the
--    badge on its next ↻ and the shop screen on its next read. To bring it back: status = 'live'.

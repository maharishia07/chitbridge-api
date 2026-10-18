-- b209 · FIVE LIVE OFFERS FOR tallytest, so the counter and the shop screen have something real to show
-- ============================================================================================================
-- Athi, 2026-09-09: "create some offers so i can see the offer slides".
--
-- WHY YOU RUN IT AND NOT ME. An offer is a DEFINITION, and only a signed-in session may author one — no API key
-- scope reaches /api/definitions, deliberately: authoring the rules that decide a price is not something a till
-- key or a connector key should ever be able to do. So this is the same route as b208.
--
-- WHAT IT MAKES. Five offers of four different kinds, chosen so every slide type has something to draw and the
-- counter's badges differ from each other:
--   1  10% off every spice                    percent_off  · category Spices
--   2  Rs 20 off cooking oil                  amount_off   · category Edible oil
--   3  Buy 2 biscuits, get 1 free             buy_x_get_y  · category Biscuits
--   4  5% off the whole bill over Rs 500      threshold    · the order total
--   5  10% off rice when you take 5 or more   percent_off  · category Rice & grains, min 5
--
-- ⚠️ THEY TARGET CATEGORIES, NOT PRODUCTS, which is why they keep working after the catalogue is reloaded — a
-- product id would be stale the moment a row is replaced. `applies_to.category` matches the string the counter
-- carries on each line, so all 4,596 spice-and-staple rows are covered without naming one of them.
--
-- Supabase -> SQL Editor -> paste -> Run. Step 1 only looks; step 2 writes.
-- ============================================================================================================

-- ── 1 · WHAT IS THERE NOW. Expect 0 rows the first time.
-- ⚠️ the context first, or under RLS this reads nothing and looks like an empty shop.
SELECT set_config('app.current_entity', 'c2837d52-47f2-47e2-9fcd-b98c68a49e45', false);

SELECT d.name, d.sub_kind, d.status, v.rules
FROM definition d
LEFT JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
WHERE d.entity_id = 'c2837d52-47f2-47e2-9fcd-b98c68a49e45' AND d.kind = 'offer'
ORDER BY d.name;

-- ── 2 · CREATE THEM.
--
-- ⭐⭐ RUN THIS **WITH RLS**, WITH THE ENTITY CONTEXT SET. Athi asked, and it matters here more than it did for b208.
--
-- `definition` and `definition_version` are ENABLE + **FORCE** ROW LEVEL SECURITY (b160), isolated on
-- `app.current_entity`. FORCE means even the table owner is subject to the policy — only a BYPASSRLS role
-- (Supabase's `postgres`, which is what the SQL Editor usually gives you) walks past it.
--
-- Setting the context is the SAFER way round, not the harder one:
--   · with it set, the policy's WITH CHECK verifies every row lands in THIS entity. Get the id wrong and the insert
--     is REFUSED — rather than quietly writing five offers into somebody else's shop, which is precisely the
--     mix-up we spent today guarding the counter against.
--   · it also makes the statement behave identically to how the application would run it (withEntity does exactly
--     this), so a passing run here means the same thing in production.
-- `false` (not `true`) as the third argument: the setting lasts for the whole session, not just this transaction,
-- so the SELECT in step 3 can still see what you wrote.
SELECT set_config('app.current_entity', 'c2837d52-47f2-47e2-9fcd-b98c68a49e45', false);

-- Both rows per offer in ONE transaction: a definition whose version 1 failed to write is a definition with no
-- rules — it would list on the shelf and resolve to nothing.
BEGIN;

WITH shop AS (SELECT 'c2837d52-47f2-47e2-9fcd-b98c68a49e45'::uuid AS id),
new_offers AS (
  SELECT * FROM (VALUES
    ('10% off every spice',                  'percent_off',
     '{"percent":10,"scope":"line","applies_to":{"category":"Spices"}}'::jsonb),
    ('Rs 20 off cooking oil',                'amount_off',
     '{"amount":20,"scope":"line","applies_to":{"category":"Edible oil"}}'::jsonb),
    ('Buy 2 biscuits, get 1 free',           'buy_x_get_y',
     '{"buy":2,"get":1,"get_percent":100,"applies_to":{"category":"Biscuits"}}'::jsonb),
    ('5% off the whole bill over Rs 500',    'threshold',
     '{"min_amount":500,"percent":5,"scope":"cart"}'::jsonb),
    ('10% off rice from 5 bags',             'percent_off',
     '{"percent":10,"scope":"line","applies_to":{"category":"Rice & grains","min_qty":5}}'::jsonb)
  ) AS t(name, sub_kind, rules)
  /**
   * ⚠️⚠️ RUNNING THIS TWICE MUST DO NOTHING. The first cut had no guard, so a second run would have created five DUPLICATE
   * offers — two "10% off every spice", both live, both firing, stacking on each other. Athi very nearly ran it again while
   * re-running the sequence, which is exactly how that happens: a script that is safe once and destructive twice is a trap
   * left lying about, and the person who trips it is always the one who trusted it the first time.
   * A migration that cannot be re-run safely is not finished.
   */
  /* ⚠️ NO STATUS TEST HERE. My first guard skipped only offers that were live, but the constraint b160 declares is
     UNIQUE (entity_id, kind, name) — it does not care about status. So after retiring "Flat 10%", a re-run would have
     sailed past the guard and hit the constraint anyway. Match what the DATABASE forbids, not what you meant. */
  WHERE NOT EXISTS (
    SELECT 1 FROM definition d
     WHERE d.entity_id = 'c2837d52-47f2-47e2-9fcd-b98c68a49e45'
       AND d.kind = 'offer' AND d.name = t.name)
),
made AS (
  INSERT INTO definition (entity_id, kind, sub_kind, name, note, status, current_version, created_by)
  SELECT shop.id, 'offer', n.sub_kind, n.name, 'seeded for testing the counter and the shop screen', 'live', 1, NULL
  FROM new_offers n, shop
  RETURNING definition_id, entity_id, name
)
INSERT INTO definition_version (definition_id, version, entity_id, rules, note, created_by)
SELECT made.definition_id, 1, made.entity_id, n.rules, 'seeded', NULL
FROM made JOIN new_offers n ON n.name = made.name;

-- ⚠️ Expect "INSERT 0 5" the FIRST time and "INSERT 0 0" on any re-run — both are correct.
--    (Without the guard the DATABASE refuses it anyway: b160 declares UNIQUE (entity_id, kind, name). That is the
--     real protection; this guard only turns a hard error into a quiet no-op.)
--    Any other number -> ROLLBACK;
COMMIT;

-- ── 3 · PROVE IT. Expect the five rows, all status = live, each with its rules.
SELECT d.name, d.sub_kind, d.status, v.rules
FROM definition d
LEFT JOIN definition_version v ON v.definition_id = d.definition_id AND v.version = d.current_version
WHERE d.entity_id = 'c2837d52-47f2-47e2-9fcd-b98c68a49e45' AND d.kind = 'offer'
ORDER BY d.name;

-- ── AFTERWARDS: press the arrow (refresh) on the counter, and open the shop screen. The offer badges appear on
--    spice, oil, biscuit and rice rows, and the screen starts drawing "On offer today" slides. Nothing else to set.

-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b235 — A DEVICE IS A CO-ASSIST UNDER A SHOP, NOT AN ENTITY AND NOT A PERSON.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"device gateway, the one we have tested, i guess it comes under IOT? and addressed as a
-- coassist?"*
--
-- Right on both counts, and the data disagrees in two different ways:
--
--     57  actor · actor_type='connector' · entity_kind='actor'    ✅ what routes/connectors.js writes today
--     17  actor · actor_type='human'     · entity_kind='actor'    ⚠️ connector kits typed as PEOPLE
--      1  ENTITY · actor_type='human'    · entity_kind='internal' ⚠️ 'Edge Gateway 01'
--
-- ── ⚠️ PART 1 · SEVENTEEN KITS ARE PRETENDING TO BE PEOPLE ─────────────────────────────────────────────────────
--
-- routes/integrations.js already carries the fix and the reason, in its own words:
--
--     *"⚠️ WAS 'human' with 10 tasks (Athi, 2026-09-06, the co-assist card: 'the type says human? and the hat
--     says editor'). A kit is a CONNECTOR: it takes no tasks (0), it has no login, and the hat stays 'act'."*
--
-- The code was corrected; the seventeen rows written before it were not. They are LIVE — a Tally kit typed
-- `human` shows on the co-assist card as a person who can be assigned work, and can be handed tasks that
-- nothing will ever pick up.
--
-- ⚠️ THIS CHANGES WHAT A SCREEN SHOWS for seventeen real connectors. That is the point, and it is why it is a
--    migration to run deliberately rather than a quiet UPDATE. max_tasks is set to 0 with it: a connector that
--    still advertises ten task slots is only half corrected.
--
-- ── ⚠️ PART 2 · 'Edge Gateway 01' CANNOT BECOME A CO-ASSIST, AND SHOULD NOT BE FORCED TO ────────────────────────
--
--     identity_id 581830e2-004b-45bd-a34d-1b7204847707
--     created 2026-07-03 · last seen 2026-07-05 · 0 supplier links · 0 children · NO parent_entity_id
--
-- A co-assist belongs to a shop. This one belongs to nobody: it was minted as a standalone ENTITY in an early
-- IoT experiment and has been inert for two months. Turning it into an actor means inventing a parent, and an
-- invented parent is a wrong answer that looks like a right one.
--
-- ⭐ So it is marked for what it actually is — an experiment — and left alone. b229 had swept it to 'internal'
-- because it is `sealed`, which put an abandoned test device in the same class as the ISO standards and the
-- platform root. It is not ours-to-operate; it is ours-to-delete, eventually.
--
-- ⚠️ AND THE RULE GOING FORWARD NEEDS NO CHANGE: routes/connectors.js already mints devices as actors under a
--    parent with actor_type 'iot_device' or 'connector'. Nothing here alters how a new device is made.
--
-- Supabase → SQL Editor → SELECT ALL → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1 · a kit is a connector, and takes no tasks
UPDATE identities
   SET actor_type = 'connector',
       max_tasks  = 0
 WHERE identity_type = 'actor'
   AND actor_type = 'human'
   AND connector_type IS NOT NULL;

-- 2 · the abandoned gateway is an experiment, not an internal fixture of the platform
UPDATE identities
   SET entity_kind = 'test'
 WHERE identity_id = '581830e2-004b-45bd-a34d-1b7204847707'
   AND display_name = 'Edge Gateway 01'
   AND entity_kind = 'internal';

-- ⚠️ and its entity_visibility follows its kind — b234 set it 'internal' when it was classified internal.
--    'test' is not ours-to-operate, so it goes back to the default rather than staying hidden as though the
--    platform depended on it.
UPDATE identities
   SET entity_visibility = 'public'
 WHERE identity_id = '581830e2-004b-45bd-a34d-1b7204847707'
   AND entity_kind = 'test';

COMMIT;

-- ── WHAT YOU SHOULD SEE ────────────────────────────────────────────────────────────────────────────────────────
SELECT identity_type, coalesce(actor_type,'—') AS actor_type, entity_kind, count(*) AS n
  FROM identities
 WHERE display_name ILIKE '%gateway%' OR connector_type IS NOT NULL
    OR actor_type IN ('iot_device','connector')
 GROUP BY 1,2,3 ORDER BY 4 DESC;

-- ⭐ EXPECTED: 74 actor · connector · actor, and NO row typed 'human' with a connector_type.
--    Edge Gateway 01 leaves this result entirely — it has no connector_type and is now 'test'.

SELECT entity_visibility, count(*) AS n FROM identities WHERE entity_kind = 'internal' GROUP BY 1;
-- ⭐ EXPECTED: internal 9 — cbincroot, seven standards, and GOV-01-Help. The gateway is no longer among them.

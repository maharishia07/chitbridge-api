-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- FRAMEWORK AUDIT — where the data disagrees with the rules the code now enforces.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-09-14: *"we are testing our product, in the early days we might have made mistake, if so correct
-- those and fit into framework."*
--
-- ⚠️ READ-ONLY. Every row it returns is a disagreement between what the data says and what the code would now
-- produce. A count of 0 everywhere means the early days left nothing behind.
--
-- ⚠️ IT AUDITS ONLY WHAT cb_app CAN READ WITHOUT AN ENTITY: identities, cb_entity, supplier_list, constitution,
--    installation. customer_list / entity_governance / catalogue_items / chit_header are RLS-forced and return
--    ZERO to an entity-less connection — which is not evidence of absence, and is a trap I fell into twice
--    today. Those need the Supabase editor. Marked ⬛ below.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

SELECT * FROM (

-- ① a dotted handle is a network branch. Anything dotted but classified otherwise was misfiled by the backfill.
SELECT 1 AS n, 'handle is dotted but entity_kind is not network' AS finding,
       count(*) AS rows, coalesce(string_agg(user_id, ' · ' ORDER BY user_id), '') AS examples
  FROM (SELECT user_id FROM identities
         WHERE identity_type = 'entity' AND coalesce(status,'active') <> 'erased'
           AND user_id LIKE '%.%' AND user_id NOT LIKE '~%' AND entity_kind <> 'network' LIMIT 5) x

UNION ALL
-- ② a tilde handle is a local supplier
SELECT 2, 'handle is ~x.sup-n but entity_kind is not supplier',
       count(*), coalesce(string_agg(user_id, ' · '), '')
  FROM (SELECT user_id FROM identities
         WHERE identity_type = 'entity' AND coalesce(status,'active') <> 'erased'
           AND user_id LIKE '~%' AND entity_kind <> 'supplier' LIMIT 5) x

UNION ALL
-- ③ classified network but no place on any tree — the classification and the structure disagree
SELECT 3, 'entity_kind=network but no cb_entity path',
       count(*), coalesce(string_agg(user_id, ' · '), '')
  FROM (SELECT i.user_id FROM identities i
         LEFT JOIN cb_entity c ON c.bridge_id = i.bridge_id
         WHERE i.entity_kind = 'network' AND c.bridge_id IS NULL LIMIT 5) x

UNION ALL
-- ④ on a tree at depth > 1 but not classified as a branch
SELECT 4, 'has a parent on the tree but entity_kind is not network',
       count(*), coalesce(string_agg(user_id, ' · '), '')
  FROM (SELECT i.user_id FROM identities i
         JOIN cb_entity c ON c.bridge_id = i.bridge_id
         WHERE nlevel(c.path) > 1 AND i.entity_kind <> 'network'
           AND coalesce(i.status,'active') <> 'erased' LIMIT 5) x

UNION ALL
-- ⑤ a cb_entity row whose identity is gone — an orphan on the tree
SELECT 5, 'cb_entity row with no matching identity',
       count(*), coalesce(string_agg(c.bridge_id, ' · '), '')
  FROM (SELECT c.bridge_id FROM cb_entity c
         LEFT JOIN identities i ON i.bridge_id = c.bridge_id
         WHERE i.bridge_id IS NULL LIMIT 5) c

UNION ALL
-- ⑥ ⚠️ handles that today's rules would REFUSE. lib/handle.js: 8-20 chars, not reserved, not CB+8.
--    Registered before the rule existed; they keep their name (checkRoot runs on NEW handles only) — but if any
--    exist, every "just re-register it" instruction in the docs is wrong for them.
SELECT 6, 'user_id shorter than the 8-char minimum',
       count(*), coalesce(string_agg(user_id, ' · '), '')
  FROM (SELECT user_id FROM identities
         WHERE identity_type = 'entity' AND user_id IS NOT NULL
           AND length(user_id) < 8 AND coalesce(status,'active') <> 'erased' LIMIT 5) x

UNION ALL
SELECT 7, 'user_id longer than the 20-char maximum',
       count(*), coalesce(string_agg(user_id, ' · '), '')
  FROM (SELECT user_id FROM identities
         WHERE identity_type = 'entity' AND user_id IS NOT NULL
           AND length(user_id) > 20 AND coalesce(status,'active') <> 'erased' LIMIT 5) x

UNION ALL
-- ⑧ an entity with no handle at all — it cannot be addressed, and sub-numbers cannot hang off it
SELECT 8, 'entity with no user_id',
       count(*), coalesce(string_agg(coalesce(display_name,'(no name)'), ' · '), '')
  FROM (SELECT display_name FROM identities
         WHERE identity_type = 'entity' AND user_id IS NULL
           AND coalesce(status,'active') <> 'erased' LIMIT 5) x

UNION ALL
-- ⑨ supplier_list pointing at an identity that no longer exists
SELECT 9, 'supplier_list row whose supplier is gone',
       count(*), ''
  FROM (SELECT s.supplier_list_id FROM supplier_list s
         LEFT JOIN identities i ON i.identity_id = s.supplier_entity_id
         WHERE i.identity_id IS NULL LIMIT 5) x

UNION ALL
-- ⑩ a shop listing itself as its own supplier
SELECT 10, 'supplier_list row where owner = supplier',
       count(*), ''
  FROM (SELECT supplier_list_id FROM supplier_list
         WHERE owner_entity_id = supplier_entity_id LIMIT 5) x

UNION ALL
-- ⑪ more than one active constitution claiming to be the default (b160 territory)
SELECT 11, 'active constitutions flagged is_default',
       count(*), coalesce(string_agg(constitution_key || '@' || version, ' · '), '')
  FROM (SELECT constitution_key, version FROM constitution WHERE is_default AND active LIMIT 5) x

UNION ALL
-- ⑫ a constitution key with NO active version — govresolve would find nothing and fall back to allowed={}
SELECT 12, 'constitution key with no active version',
       count(*), coalesce(string_agg(constitution_key, ' · '), '')
  FROM (SELECT constitution_key FROM constitution
         GROUP BY constitution_key HAVING bool_and(NOT active) LIMIT 5) x

UNION ALL
-- ⑬ an installation naming a vertical no constitution provides
SELECT 13, 'installation.vertical_key with no matching constitution',
       count(*), coalesce(string_agg(installation_key || ' -> ' || vertical_key, ' · '), '')
  FROM (SELECT i.installation_key, i.vertical_key FROM installation i
         WHERE i.vertical_key IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM constitution c WHERE c.constitution_key = i.vertical_key) LIMIT 5) x

UNION ALL
-- ⑭ an actor whose parent entity is gone
SELECT 14, 'actor whose parent entity no longer exists',
       count(*), coalesce(string_agg(coalesce(display_name,'?'), ' · '), '')
  FROM (SELECT a.display_name FROM identities a
         LEFT JOIN identities p ON p.identity_id = a.parent_entity_id
         WHERE a.identity_type = 'actor' AND a.parent_entity_id IS NOT NULL
           AND p.identity_id IS NULL LIMIT 5) x

UNION ALL
-- ⑮ two identities sharing a bridge_id — it is meant to be unique and is used as an address
SELECT 15, 'bridge_id used by more than one identity',
       count(*), coalesce(string_agg(bridge_id, ' · '), '')
  FROM (SELECT bridge_id FROM identities GROUP BY bridge_id HAVING count(*) > 1 LIMIT 5) x

) audit
WHERE rows > 0            -- ⭐ only disagreements. An empty result is the good outcome.
ORDER BY n;

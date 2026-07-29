-- cleanup-0-suggest.sql — READ-ONLY. Emits a ready-made keep-list you can paste into cleanup-2-delete.sql.
--
-- It proposes an entity for keeping when ANY of these is true, and tells you WHICH reason fired:
--    owns-blueprint   deleting it leaves a published blueprint permanently uneditable (the irreversible one)
--    has-chits        real records exist under it
--    has-catalogue    real items or adoptions exist under it
--    looks-like-you   the address pattern suggests it is your own login
--
-- Read the `why` column before trusting a row. This SUGGESTS; you decide.
-- ⚠️ Confirm which database you are connected to first.

SET row_security = off;

WITH scored AS (
  SELECT i.identity_id, i.bridge_id, i.display_name, i.email, i.last_active_at,
         (SELECT count(*) FROM catalogue_source   s WHERE s.owner_entity_id = i.identity_id) AS blueprints,
         (SELECT count(*) FROM chit_header        c WHERE c.entity_id       = i.identity_id) AS chits,
         (SELECT count(*) FROM catalogue_items    x WHERE x.entity_id       = i.identity_id) AS items,
         (SELECT count(*) FROM catalogue_adoption a WHERE a.entity_id       = i.identity_id) AS adoptions,
         (i.email ILIKE '%gmail%' OR i.email ILIKE '%athi%' OR i.email ILIKE '%narayan%')     AS looks_like_you
  FROM identities i
  WHERE i.identity_type = 'entity'
)
SELECT
  -- paste-ready line for the _keep_spec VALUES block
  '  (''' || email || ''', NULL),' AS paste_this_line,
  bridge_id, display_name, email,
  concat_ws(' + ',
    CASE WHEN blueprints > 0    THEN 'owns-blueprint(' || blueprints || ')' END,
    CASE WHEN chits > 0         THEN 'has-chits(' || chits || ')' END,
    CASE WHEN items + adoptions > 0 THEN 'has-catalogue(' || (items + adoptions) || ')' END,
    CASE WHEN looks_like_you    THEN 'looks-like-you' END
  ) AS why,
  last_active_at::date AS last_seen
FROM scored
WHERE blueprints > 0 OR chits > 0 OR items > 0 OR adoptions > 0 OR looks_like_you
ORDER BY blueprints DESC, chits DESC, (items + adoptions) DESC, last_active_at DESC NULLS LAST;

-- How many entities does that keep, and how many would go?
WITH scored AS (
  SELECT i.identity_id,
         (SELECT count(*) FROM catalogue_source   s WHERE s.owner_entity_id = i.identity_id) AS blueprints,
         (SELECT count(*) FROM chit_header        c WHERE c.entity_id       = i.identity_id) AS chits,
         (SELECT count(*) FROM catalogue_items    x WHERE x.entity_id       = i.identity_id) AS items,
         (SELECT count(*) FROM catalogue_adoption a WHERE a.entity_id       = i.identity_id) AS adoptions,
         (i.email ILIKE '%gmail%' OR i.email ILIKE '%athi%' OR i.email ILIKE '%narayan%')     AS looks_like_you
  FROM identities i WHERE i.identity_type = 'entity'
)
SELECT count(*) FILTER (WHERE blueprints>0 OR chits>0 OR items>0 OR adoptions>0 OR looks_like_you) AS suggested_keep,
       count(*) FILTER (WHERE NOT (blueprints>0 OR chits>0 OR items>0 OR adoptions>0 OR looks_like_you)) AS pure_litter,
       count(*) AS total_entities
FROM scored;

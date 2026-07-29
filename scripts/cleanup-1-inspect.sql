-- cleanup-1-inspect.sql — READ-ONLY. Safe to paste whole and run. Deletes nothing, changes nothing.
-- Decide your keep-list from what this shows you, then use scripts/cleanup-2-delete.sql.
--
-- ⚠️ Confirm which database you are connected to first. The Railway host is named "…-production…" but is wired to
--    the dev database — the name is not the proof.

SET row_security = off;   -- session-scoped; this file is one paste, one session

-- ── 1 · WHO IS WORTH KEEPING — ranked by real activity ────────────────────────────────────────────────────
-- Anything with chits / items / adoptions / blueprints is a candidate. The long tail of zeros is test litter.
SELECT i.bridge_id, i.display_name, i.email,
       i.created_at::date AS created, i.last_active_at::date AS last_seen,
       (SELECT count(*) FROM chit_header        c WHERE c.entity_id       = i.identity_id) AS chits,
       (SELECT count(*) FROM catalogue_items    x WHERE x.entity_id       = i.identity_id) AS items,
       (SELECT count(*) FROM catalogue_adoption a WHERE a.entity_id       = i.identity_id) AS adoptions,
       (SELECT count(*) FROM catalogue_source   s WHERE s.owner_entity_id = i.identity_id) AS blueprints_owned
FROM identities i
WHERE i.identity_type = 'entity'
  AND ( EXISTS (SELECT 1 FROM chit_header        c WHERE c.entity_id       = i.identity_id)
     OR EXISTS (SELECT 1 FROM catalogue_items    x WHERE x.entity_id       = i.identity_id)
     OR EXISTS (SELECT 1 FROM catalogue_adoption a WHERE a.entity_id       = i.identity_id)
     OR EXISTS (SELECT 1 FROM catalogue_source   s WHERE s.owner_entity_id = i.identity_id) )
ORDER BY blueprints_owned DESC, chits DESC, items DESC, adoptions DESC, i.last_active_at DESC NULLS LAST;

-- ── 2 · EVERY BLUEPRINT AND WHO OWNS IT ───────────────────────────────────────────────────────────────────
-- catalogue_source has owner_entity_id but NO entity_id, so a blueprint SURVIVES a wipe and becomes permanently
-- UNEDITABLE if its owner is deleted (writes are gated app-side on that owner). Keep the owner, or accept a
-- read-only blueprint forever. These owners are the ones people forget.
SELECT s.source_key, s.title, s.for_vertical, s.active,
       i.bridge_id AS owner_bridge, i.display_name AS owner_name, i.email AS owner_email,
       CASE WHEN i.identity_id IS NULL THEN 'ALREADY ORPHANED' ELSE 'has a live owner' END AS state
FROM catalogue_source s
LEFT JOIN identities i ON i.identity_id = s.owner_entity_id
ORDER BY s.active DESC, s.source_key;

-- ── 3 · YOUR OWN LOGINS — find yourself before you delete anyone ──────────────────────────────────────────
-- Adjust the pattern if your address differs. If this returns nothing, DO NOT run the delete script.
SELECT bridge_id, display_name, email, created_at::date, last_active_at::date
FROM identities
WHERE identity_type = 'entity'
  AND (email ILIKE '%gmail%' OR email ILIKE '%athi%' OR email ILIKE '%narayan%')
ORDER BY last_active_at DESC NULLS LAST;

-- ── 4 · THE SHAPE OF THE PROBLEM ──────────────────────────────────────────────────────────────────────────
SELECT count(*) FILTER (WHERE identity_type = 'entity')   AS entities,
       count(*) FILTER (WHERE identity_type = 'actor')    AS actors,
       count(*) FILTER (WHERE identity_type = 'customer') AS storefront_customers,
       count(*)                                           AS all_identities
FROM identities;

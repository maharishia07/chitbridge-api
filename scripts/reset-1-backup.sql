-- reset-1-backup.sql — READ-ONLY. Cheap insurance before a full wipe. Copy the output into a file and keep it.
--
-- ⚠️ YOU PROBABLY DO NOT NEED THIS, and it is worth knowing why before you rely on it:
--   • `catalogue_source` (every published blueprint, incl. Royale Play) has NO entity_id column, so it is NOT
--     touched by an identity wipe. The blueprints survive on their own. Only `owner_entity_id` is left dangling.
--   • Royale Play is ALSO in version control — migrations/b75_catalogue_reference.sql seeds
--     'beta-royale-play@v1' with all six finishes. Re-running that INSERT restores it from scratch.
-- Take the snapshot anyway: it captures anything EDITED since the migration, which git cannot know about.

SET row_security = off;

-- 1 · every blueprint, as one JSON blob. Copy the whole cell into e.g. C:\dev\backup-sources-YYYY-MM-DD.json
SELECT jsonb_pretty(jsonb_agg(to_jsonb(s) ORDER BY s.source_key)) AS catalogue_sources_backup
FROM catalogue_source s;

-- 2 · who owns what right now (the ONLY thing a wipe actually destroys — the ownership pointer)
SELECT s.source_key, s.title, s.active,
       s.owner_entity_id,
       i.bridge_id  AS owner_bridge,
       i.email      AS owner_email,
       i.display_name AS owner_name
FROM catalogue_source s
LEFT JOIN identities i ON i.identity_id = s.owner_entity_id
ORDER BY s.source_key;

-- 3 · anything else worth knowing before it goes
SELECT (SELECT count(*) FROM catalogue_source)                            AS blueprints,
       (SELECT count(*) FROM identities WHERE identity_type='entity')     AS entities,
       (SELECT count(*) FROM identities WHERE identity_type='actor')      AS actors,
       (SELECT count(*) FROM identities WHERE identity_type='customer')   AS customers,
       (SELECT count(*) FROM chit_header)                                 AS chits;

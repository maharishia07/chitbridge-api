-- cleanup-0-suggest.sql — READ-ONLY. Emits a keep-list for cleanup-2-delete.sql.
--
-- ⚠️ v1 of this query was USELESS: it suggested 426 of 780 entities, because "has activity" is not a
--    discriminator — the test harnesses create entities AND send chits between them, so nearly everything has
--    activity. The real discriminator is the EMAIL DOMAIN: our fixtures use a fixed set of test domains, and an
--    entity on one of those is litter no matter how busy it looks.
--
-- TIERS, most-important first:
--    A · MUST KEEP     owns a published blueprint (deleting it makes the blueprint permanently uneditable),
--                      or looks like your own login
--    B · PROBABLY KEEP a NON-test address with real activity — i.e. something a human made on purpose
--    C · LITTER        a test-domain address, whatever its activity
--
-- ⚠️ Confirm which database you are connected to first.

SET row_security = off;

WITH e AS (
  SELECT i.identity_id, i.bridge_id, i.display_name, i.email, i.last_active_at,
         (i.email ILIKE '%@test.example' OR i.email ILIKE '%@test.com'  OR i.email ILIKE '%@test-cb.com'
       OR i.email ILIKE '%@demo-cb.com'  OR i.email ILIKE '%@example.com' OR i.email ILIKE '%@t.com'
       OR i.email ILIKE '%@x.com'   OR i.email ILIKE '%.cr')                                     AS is_test_domain,
         (i.email ILIKE '%gmail%' OR i.email ILIKE '%athi%' OR i.email ILIKE '%narayan%')         AS looks_like_you,
         (SELECT count(*) FROM catalogue_source   s WHERE s.owner_entity_id = i.identity_id)      AS blueprints,
         (SELECT count(*) FROM chit_header        c WHERE c.entity_id       = i.identity_id)      AS chits,
         (SELECT count(*) FROM catalogue_items    x WHERE x.entity_id       = i.identity_id)
       + (SELECT count(*) FROM catalogue_adoption a WHERE a.entity_id       = i.identity_id)      AS catalogue
  FROM identities i WHERE i.identity_type = 'entity'
),
tiered AS (
  SELECT *, CASE
    WHEN blueprints > 0 OR looks_like_you                        THEN 'A · MUST KEEP'
    WHEN NOT is_test_domain AND (chits > 0 OR catalogue > 0)     THEN 'B · PROBABLY KEEP'
    ELSE                                                              'C · LITTER'
  END AS tier FROM e
)
-- 1 · the shape: how big is each tier?
SELECT tier, count(*) AS entities,
       sum(blueprints) AS blueprints, sum(chits) AS chits, sum(catalogue) AS catalogue_rows
FROM tiered GROUP BY tier ORDER BY tier;

-- 2 · the keep-list itself — tiers A and B only. Paste `paste_this_line` into _keep_spec.
WITH e AS (
  SELECT i.identity_id, i.bridge_id, i.display_name, i.email, i.last_active_at,
         (i.email ILIKE '%@test.example' OR i.email ILIKE '%@test.com'  OR i.email ILIKE '%@test-cb.com'
       OR i.email ILIKE '%@demo-cb.com'  OR i.email ILIKE '%@example.com' OR i.email ILIKE '%@t.com'
       OR i.email ILIKE '%@x.com'   OR i.email ILIKE '%.cr')                                     AS is_test_domain,
         (i.email ILIKE '%gmail%' OR i.email ILIKE '%athi%' OR i.email ILIKE '%narayan%')         AS looks_like_you,
         (SELECT count(*) FROM catalogue_source   s WHERE s.owner_entity_id = i.identity_id)      AS blueprints,
         (SELECT count(*) FROM chit_header        c WHERE c.entity_id       = i.identity_id)      AS chits,
         (SELECT count(*) FROM catalogue_items    x WHERE x.entity_id       = i.identity_id)
       + (SELECT count(*) FROM catalogue_adoption a WHERE a.entity_id       = i.identity_id)      AS catalogue
  FROM identities i WHERE i.identity_type = 'entity'
)
SELECT CASE WHEN blueprints > 0 OR looks_like_you THEN 'A · MUST KEEP' ELSE 'B · PROBABLY KEEP' END AS tier,
       '  (''' || email || ''', NULL),' AS paste_this_line,
       bridge_id, display_name, email,
       concat_ws(' + ',
         CASE WHEN blueprints > 0 THEN 'owns-blueprint(' || blueprints || ')' END,
         CASE WHEN looks_like_you THEN 'looks-like-you' END,
         CASE WHEN chits > 0      THEN 'chits(' || chits || ')' END,
         CASE WHEN catalogue > 0  THEN 'catalogue(' || catalogue || ')' END,
         CASE WHEN is_test_domain THEN 'TEST-DOMAIN' END) AS why,
       last_active_at::date AS last_seen
FROM e
WHERE blueprints > 0 OR looks_like_you OR (NOT is_test_domain AND (chits > 0 OR catalogue > 0))
ORDER BY blueprints DESC, looks_like_you DESC, chits DESC;

-- 3 · SANITY — a test-domain entity that owns a blueprint is a real decision, not an oversight.
--     (e.g. the Document Services demo store owns document-services@v1.)
SELECT bridge_id, display_name, email, blueprints,
       'test-domain BUT owns a blueprint — keep it, or the blueprint is uneditable forever' AS note
FROM (
  SELECT i.bridge_id, i.display_name, i.email,
         (i.email ILIKE '%@test.example' OR i.email ILIKE '%@test.com' OR i.email ILIKE '%@test-cb.com'
       OR i.email ILIKE '%@demo-cb.com' OR i.email ILIKE '%@example.com' OR i.email ILIKE '%@t.com'
       OR i.email ILIKE '%@x.com') AS is_test_domain,
         (SELECT count(*) FROM catalogue_source s WHERE s.owner_entity_id = i.identity_id) AS blueprints
  FROM identities i WHERE i.identity_type = 'entity'
) q WHERE is_test_domain AND blueprints > 0;

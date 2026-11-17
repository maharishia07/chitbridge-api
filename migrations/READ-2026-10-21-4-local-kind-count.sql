-- READ-2026-10-21-4 · K-DB / OPS-41 · how many minted parties ('~' handles) carry which entity_kind, by the handle's side (cus / sup / other)
-- READ-ONLY. Paste the ONE json value back. Moving them to 'local' is Athi's call AFTER b769 (MANIFEST.md, Needs Athi); this only counts.
WITH minted AS (SELECT entity_kind,
                       CASE WHEN user_id ~ '\.cus-[0-9]+$' THEN 'cus' WHEN user_id ~ '\.sup-[0-9]+$' THEN 'sup' ELSE 'other' END AS side,
                       population
                  FROM identities
                 WHERE identity_type = 'entity' AND user_id LIKE '~%')
SELECT json_build_object(
  'minted_total', (SELECT count(*) FROM minted),
  'by_kind_and_side', (SELECT json_agg(t ORDER BY t.n DESC) FROM (SELECT entity_kind, side, count(*) n FROM minted GROUP BY 1, 2) t),
  'test_population', (SELECT count(*) FROM minted WHERE population <> 'live')
) AS local_kind_count;

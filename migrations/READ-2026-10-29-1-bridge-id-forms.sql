-- READ-2026-10-29-1 · RAIL-140 (f) / Q22 · how many bridge ids are in generateBridgeId's form (CB + 8 of its 32-letter alphabet), how many are CB + something else, and how many are neither
-- READ-ONLY. Paste the ONE json value back. Whether ctpaddress.parse may hold a bridge id to the form is decided AFTER this count; this only counts.
-- The alphabet is lib/bridgeid.js CHARS: A-Z without I and O, and 2-9 (no 0, no 1). No bridge id or name is returned, only counts and lengths.
WITH ids AS (SELECT identity_type,
                    coalesce(status, 'active') AS status,
                    population,
                    CASE WHEN bridge_id ~ '^CB[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$' THEN 'cb_plus_8'
                         WHEN bridge_id ~* '^cb' THEN 'cb_other'
                         ELSE 'other' END AS form,
                    bridge_id <> upper(bridge_id) AS has_lower_case,
                    length(bridge_id) AS len
               FROM identities
              WHERE bridge_id IS NOT NULL)
SELECT json_build_object(
  'total', (SELECT count(*) FROM ids),
  'by_form', (SELECT json_agg(t ORDER BY t.n DESC) FROM (SELECT form, identity_type, status, population, count(*) n FROM ids GROUP BY 1, 2, 3, 4) t),
  'lower_case', (SELECT count(*) FROM ids WHERE has_lower_case),
  'lengths_outside_the_form', (SELECT json_agg(t ORDER BY t.len) FROM (SELECT len, count(*) n FROM ids WHERE form <> 'cb_plus_8' GROUP BY 1) t),
  'no_bridge_id', (SELECT count(*) FROM identities WHERE bridge_id IS NULL)
) AS bridge_id_forms;

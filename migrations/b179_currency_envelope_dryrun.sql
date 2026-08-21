-- b179 · DRY RUN — what the four-currency cap is doing today. Reads only; changes nothing.
--
-- Athi, 2026-08-21: "we are showcasing only a few currencies — does it mean it cannot work for any other
-- currency? Singapore dollar, yuan and other things are not here. It should work for any currency, correct?"
--
-- It was never a design limit. b74_platform_governance.sql seeded the BASE constitution with
--     "allowed": {"currencies":["INR","USD","MXN","EUR"], ...}
-- four codes typed into a bootstrap row to make a demo work. The profile picker and the PATCH /profile
-- validator both read that envelope, so four became the ceiling for every business on the platform. A demo
-- fixture had quietly become policy.
--
-- The MECHANISM is right and stays: a constitution that genuinely restricts trade to certain currencies must
-- be able to say so, and the route already refuses with the permitted set named. What is wrong is that the
-- WIDEST constitution — 'base', which everybody inherits — carries a restriction at all. Under tighten-only
-- governance the universe is the one thing that must not narrow.
--
-- ⚠️ THIS QUERY DELIBERATELY DOES NOT JOIN entity_governance. That table is FORCE ROW LEVEL SECURITY (b73), and
-- its policy is `entity_id = NULLIF(current_setting('app.current_entity',true),'')::uuid` — with the GUC unset,
-- as it is in the SQL editor, that is `entity_id = NULL`, which matches nothing. A count through it would come
-- back 0 for every constitution and read as "nobody is affected" when the truth is "nothing was visible".
-- Reading a per-entity table cross-tenant to answer a platform question is the mistake; identities is the
-- deliberate WITHOUT RLS carve-out (b54) and answers the question that actually matters.

-- 1 · the envelope, per constitution
SELECT
  'envelope'                                                                             AS report,
  c.constitution_key,
  c.version::text                                                                        AS version,
  COALESCE((c.governance -> 'allowed' -> 'currencies')::text, '(none — any currency)')    AS currencies_allowed,
  c.governance -> 'defaults' ->> 'currency'                                              AS default_currency,
  CASE WHEN c.constitution_key = 'base' AND c.governance -> 'allowed' ? 'currencies'
       THEN 'WILL BE LIFTED by the apply script'
       WHEN c.governance -> 'allowed' ? 'currencies'
       THEN 'left alone — a non-base constitution may restrict on purpose'
       ELSE 'no currency restriction' END                                                AS verdict
FROM constitution c
WHERE c.active = true

UNION ALL

-- 2 · what businesses actually price in today, and whether the cap would have refused it
SELECT
  'in use'                                                        AS report,
  COALESCE(i.currency_code, '(unset)')                            AS constitution_key,
  count(*)::text                                                  AS version,
  CASE WHEN i.currency_code IS NULL THEN 'n/a'
       WHEN EXISTS (SELECT 1 FROM constitution b
                     WHERE b.constitution_key = 'base' AND b.active
                       AND (b.governance -> 'allowed' -> 'currencies') ? i.currency_code)
       THEN 'permitted today'
       ELSE 'REFUSED by the current cap' END                       AS currencies_allowed,
  NULL                                                            AS default_currency,
  'businesses'                                                    AS verdict
FROM identities i
WHERE i.identity_type = 'entity'
GROUP BY i.currency_code

ORDER BY report, constitution_key;

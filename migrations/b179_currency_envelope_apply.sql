-- b179 · APPLY — lift the four-currency cap off the BASE constitution.
-- Run b179_currency_envelope_dryrun.sql first.
--
-- What this does: removes the "currencies" key from base.governance.allowed. It does NOT add a longer list.
-- An absent key means unbounded, which is what bounded() in lib/govresolve.js already does with it — so the
-- full ISO 4217 table (162 codes, from Intl in the browser) becomes selectable and the validator stops
-- refusing SGD, CNY, JPY and 155 others.
--
-- What this does NOT do, deliberately:
--   · it leaves every OTHER constitution untouched. A vertical or jurisdiction that restricts currency is
--     making a real statement, and tighten-only means a child may narrow what base leaves open.
--   · it leaves regions, timezones and languages alone. They are capped in the same seeded row, but the UI
--     already bypasses two of them (the zone picker reads Intl.supportedValuesOf, ~400 zones) and languages
--     are bounded by the shipped packs, not by this list. Widening those is a separate decision with a
--     separate blast radius — not a side effect of a currency fix.
--
-- Reversible: re-adding the key restores the old behaviour exactly.

BEGIN;

UPDATE constitution
   SET governance = jsonb_set(governance, '{allowed}', (governance -> 'allowed') - 'currencies'),
       version    = version + 1
 WHERE constitution_key = 'base'
   AND active = true
   AND governance -> 'allowed' ? 'currencies';

-- One result set: what the envelope looks like now, and proof nothing else moved.
SELECT
  constitution_key,
  version,
  CASE WHEN governance -> 'allowed' ? 'currencies'
       THEN 'still capped: ' || (governance -> 'allowed' ->> 'currencies')
       ELSE 'any currency' END                                    AS currencies,
  CASE WHEN governance -> 'allowed' ? 'regions'
       THEN jsonb_array_length(governance -> 'allowed' -> 'regions')::text ELSE 'any' END   AS regions,
  CASE WHEN governance -> 'allowed' ? 'timezones'
       THEN jsonb_array_length(governance -> 'allowed' -> 'timezones')::text ELSE 'any' END AS timezones,
  governance -> 'defaults' ->> 'currency'                          AS default_currency
FROM constitution
WHERE active = true
ORDER BY (constitution_key <> 'base'), constitution_key;

COMMIT;

-- money-4-mis.sql — READ ONLY. The answer to: three stores, INR + USD + AED, all CC'ing one network.
--
-- Athi, 2026-07-31: "the network gets chits of 3 different currencies, now you make a sum of the value and the
-- product in some MIS, how do you do that?"
--
-- ── THE ANSWER: there is no single money number, and any system that shows one is lying. ─────────────────────
--
-- Adding INR + USD + AED produces a figure with no unit. It is not approximate, it is meaningless — the same way
-- adding kilograms to litres is. So an MIS does three separate things, and only ONE of them is a money total:
--
--   A · SPLIT BY CURRENCY      three rows, three totals. The truthful primary view. Never one row.
--   B · ROLL UP THE PRODUCT    quantity IS summable across currencies. 300 kg is a TRUE number. This is the one
--                              genuine cross-store total, and CB already has the axis for it.
--   C · REPORTING OVERLAY      one number, only if someone demands it — converted, with the rate and its date
--                              shown, labelled DERIVED, and never written to a chit.
--
-- Set the network's entity id once:
\set net '00000000-0000-0000-0000-000000000000'

\echo '=== A · MONEY, SPLIT BY CURRENCY — the primary view ==='
SELECT
  COALESCE(currency_code, '(none)')                    AS currency,
  count(*)                                             AS chits,
  count(*) FILTER (WHERE total_value IS NOT NULL)      AS valued,
  count(*) FILTER (WHERE total_value IS NULL)          AS unvalued,
  sum(total_value)                                     AS total
FROM chit_header
WHERE entity_id = :'net'
GROUP BY 1
ORDER BY total DESC NULLS LAST;
--
-- Read the '(none)' row as ACTIVITY, not money: a help desk ticket, an enquiry, a filled form. It has no currency
-- because it never had a price. It belongs in a volume metric, never in a value one.
--
-- `unvalued` inside a real currency is different again — an OFFER under negotiation. Monetary, but nobody has
-- agreed the number yet, so it must not be added to anything.
--
-- ⚠ THE QUERY THIS REPLACES, and why it was wrong:
--      SELECT sum(COALESCE(total_value,0)) FROM chit_header WHERE entity_id = :net;
--   It added three currencies into one number AND counted every help-desk ticket as a zero-value trade, which
--   silently deflated any per-chit average computed from it.

\echo ''
\echo '=== B · THE PRODUCT — the one total that IS true across currencies ==='
-- Quantity has a unit that does not vary by country. This is the honest cross-store roll-up, and for a network it
-- is usually the number the operator actually wants: not "what was it worth" but "how much moved".
SELECT
  li->>'name'                                                     AS product,
  COALESCE(li->>'unit', '(unit not stated)')                      AS unit,
  count(DISTINCT h.chit_id)                                       AS chits,
  count(DISTINCT h.currency_code)                                 AS currencies_involved,
  sum((li->>'qty')::numeric)                                      AS quantity
FROM chit_header h
JOIN chit_detail d  ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id
CROSS JOIN LATERAL jsonb_array_elements(d.line_items) AS li
WHERE h.entity_id = :'net'
  AND jsonb_typeof(d.line_items) = 'array'
  AND (li->>'qty') ~ '^-?[0-9.]+$'
GROUP BY 1,2
ORDER BY quantity DESC;
--
-- `currencies_involved > 1` is the useful signal: the SAME product sold in three currencies. That is a real
-- commercial fact and it is invisible in any money-only view.
--
-- ⚠ Do NOT sum across differing `unit` values. Grouping by unit is what stops kg being added to litres — the same
--   mistake as adding INR to USD, one dimension over.

\echo ''
\echo '=== C · THE REPORTING OVERLAY — one number, honestly labelled ==='
-- Only if a human insists on a single figure. Everything here is DERIVED and none of it may be written back.
--
-- Note what is NOT in this file: a rate table. Rates belong to a dated feed or the ERP, not to a migration script
-- and not to source code — chitbridge-web carried a hard-coded _FX table and it was stale the day it shipped.
--
--   WITH fx(currency, rate_to_inr, as_of, source) AS (VALUES
--     ('INR', 1.0000, DATE '2026-07-31', 'base'),
--     ('USD', 0.0000, DATE '2026-07-31', 'PUT A REAL DATED RATE HERE'),
--     ('AED', 0.0000, DATE '2026-07-31', 'PUT A REAL DATED RATE HERE'))
--   SELECT sum(h.total_value * f.rate_to_inr) AS approx_total_inr,
--          'DERIVED — converted at rates as of ' || max(f.as_of) || '. Not a settled figure.' AS caveat
--   FROM chit_header h JOIN fx f ON f.currency = h.currency_code
--   WHERE h.entity_id = :'net' AND h.total_value IS NOT NULL;
--
-- Rules for anyone who uncomments this:
--   1. The rate, its date and its source appear NEXT TO the number, every time. A converted figure without them
--      is indistinguishable from a settled one, which is the whole problem.
--   2. It is never stored on a chit. A chit carries the currency it was agreed in, permanently.
--   3. Section A stays on the same screen. The overlay supplements the split; it never replaces it.

\echo ''
\echo '=== D · SANITY — is any single chit self-inconsistent? ==='
-- Both copies of one chit must agree on denomination. Two parties disagreeing about the currency of the same order
-- is precisely the dispute the rail exists to prevent, so it is worth asserting rather than assuming.
SELECT chit_id, count(DISTINCT currency_code) AS distinct_currencies,
       array_agg(DISTINCT currency_code)      AS codes
FROM chit_header
GROUP BY chit_id
HAVING count(DISTINCT currency_code) > 1;
-- EXPECT ZERO ROWS. Any row here is a co-held record whose two copies disagree — investigate before trusting any
-- total above it.

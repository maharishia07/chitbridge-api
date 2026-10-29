-- READ-2026-10-29-1-fin52-zero-marks-census.sql · FIN-52 / FIN-55 (api #504) · READ-ONLY. ONE result set, COUNTS ONLY. Paste every row back.
-- Before #504, POST /api/chits/:chit_id/payment with amount 0 (or no amount and no quoted total) marked the copy paid and parked a
-- Waiting row the retry could never post ("no amount and no quoted total"); a stranger's bill pressed "other" did the same ("no ledger yet").
-- Row 'copies marked paid for 0' = chit_header copies whose payment slot says 0. Row 'waiting rows for a 0 press' = books_outbox rows,
-- still open, whose why names the old or the new zero sentence. Row 'waiting rows for other' = still-open rows parked on "no ledger yet"
-- (some of these are legitimate: a known party by "other"; the stranger ones cannot be told apart from a count).
-- ⚠️ Nothing here changes data. A non-zero count is Athi's decision: the owner clears a mark with DELETE /api/chits/:id/payment
--    (which leaves the Waiting row — FIN-56), or cb-finance writes a RUN- file for the rows named.
SELECT 'copies marked paid for 0' AS what, count(*) AS rows
  FROM chit_header
 WHERE business_json ? 'payment'
   AND jsonb_typeof(business_json->'payment') = 'object'
   AND NOT (business_json->'payment' ? 'parts')
   AND COALESCE(NULLIF(business_json->'payment'->>'amount', ''), '0')::numeric = 0
UNION ALL
SELECT 'waiting rows for a 0 press', count(*)
  FROM books_outbox
 WHERE done_at IS NULL
   AND (why ILIKE '%no amount and no quoted total%' OR why ILIKE '%amount is 0%')
UNION ALL
SELECT 'waiting rows for other (no ledger yet)', count(*)
  FROM books_outbox
 WHERE done_at IS NULL
   AND why ILIKE 'Paid (%' AND why ILIKE '%no ledger yet%';

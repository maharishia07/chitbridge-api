-- READ-2026-10-29 · RAIL-149 HOTFIX · how many purchase-side chits lost a line price after batch 10 went live (2026-10-29 ~14:30 UTC)
-- READ-ONLY: one SELECT, no UPDATE, no DELETE, no DDL, no repair. Paste the ONE json value back. Nothing here changes a row.
--
-- WHY. Since batch 10 (RAIL-146) a co-assist without can_see_costs cannot read a price on a chit his shop BUYS on, so resuming a priced PO draft shows no price and
-- re-sending it posts the line with price null (or the web's 0) over the stored one. A draft re-save and a send both rewrite the draft's chit_detail row, so a row
-- whose chit_detail.created_at is after the cut-off, on the sender's own copy, with a null or 0 line price, is a candidate.
-- WHAT A HIT MEANS. The line may have lost the supplier's rate the author typed. It is NOT proof: an unpriced draft the author never priced (a line typed as a note
-- or a quantity-only request) reads the same, and so does an intentional price of 0. Read `lines_null`, `lines_zero` and `sample` beside the chit before anyone says a rate was lost.
-- WHAT IT CANNOT SEE. The price the author typed is overwritten, so this finds the SYMPTOM (a missing price on a buy-side chit saved after the cut-off), not the lost figure.
-- The buy side is an approximation of lib/cost-view costSideOf: the shop's own copy (entity = sender), purpose not 'income', whose other party is on its supplier_list
-- or on neither list (unknown hides, as the code does); a customer-only party is a sale and is left out. Drafts and sent chits both appear (role = 'Draft' or not).
-- chit_detail.created_at is timestamp WITHOUT time zone, written by now() on the database clock (UTC on Railway); change the literal if yours is not.
WITH p AS (SELECT TIMESTAMP '2026-10-29 14:30:00' AS since),
mine AS (
  SELECT h.chit_id, h.entity_id, h.role, h.purpose, d.created_at AS saved_at, d.line_items,
         (SELECT r->>'entity_id' FROM jsonb_array_elements(h.all_recipients) r
           WHERE r->>'entity_id' IS DISTINCT FROM h.entity_id::text LIMIT 1) AS other_id
    FROM chit_header h
    JOIN chit_detail d ON d.chit_id = h.chit_id AND d.entity_id = h.entity_id AND d.direction = h.direction
   WHERE h.entity_id = h.sender_entity_id
     AND h.purpose <> 'income'
     AND d.created_at >= (SELECT since FROM p)
),
buy AS (
  SELECT m.*
    FROM mine m
   WHERE EXISTS (SELECT 1 FROM supplier_list s WHERE s.owner_entity_id = m.entity_id AND s.supplier_entity_id::text = m.other_id)
      OR NOT EXISTS (SELECT 1 FROM customer_list c WHERE c.owner_entity_id = m.entity_id AND c.customer_identity_id::text = m.other_id)
),
counted AS (
  SELECT b.chit_id, b.entity_id, b.role, b.purpose, b.saved_at,
         count(*) AS lines_total,
         count(*) FILTER (WHERE l->>'price' IS NULL) AS lines_null,
         count(*) FILTER (WHERE l->>'price' ~ '^\s*0*(\.0*)?\s*$') AS lines_zero
    FROM buy b,
         jsonb_array_elements(CASE WHEN jsonb_typeof(b.line_items) = 'array' THEN b.line_items ELSE '[]'::jsonb END) l
   GROUP BY b.chit_id, b.entity_id, b.role, b.purpose, b.saved_at
)
SELECT json_build_object(
  'since', (SELECT since FROM p),
  'buy_side_chits_saved_since', (SELECT count(*) FROM buy),
  'chits_with_a_null_price_line', (SELECT count(*) FROM counted WHERE lines_null > 0),
  'chits_with_a_zero_price_line', (SELECT count(*) FROM counted WHERE lines_zero > 0),
  'drafts_among_them', (SELECT count(*) FROM counted WHERE role = 'Draft' AND (lines_null > 0 OR lines_zero > 0)),
  'sample', (SELECT json_agg(t ORDER BY t.saved_at DESC) FROM (
               SELECT chit_id, entity_id, role, purpose, saved_at, lines_total, lines_null, lines_zero
                 FROM counted WHERE lines_null > 0 OR lines_zero > 0 ORDER BY saved_at DESC LIMIT 200) t)
) AS rail149_null_price_after_batch10;

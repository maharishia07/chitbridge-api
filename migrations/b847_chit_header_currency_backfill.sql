-- b847_chit_header_currency_backfill.sql — CUR-1 slice 3 (8 Nov 2026): the chit_header.currency_code backfill, batched, evidence widened, sealed rows untouched. Needs b846.
--
-- ⚠️ NOT RUN on production · Athi runs it (Supabase SQL editor, AS postgres: RLS does not apply to the owner, so one run sees every shop) after SIT has run it and the census
--    (READ-2026-11-09-1-cur1-census.sql) has been read. THE BATCH RUNS REPEATEDLY: run the one WITH statement below again and again until it reports UPDATE 0 (each run is its
--    own statement, so its own transaction: 5000 headers, SKIP LOCKED so a live writer is never queued behind it). The chain runs the file once (one batch); the rest is the
--    re-run. It is re-run once more after api slice 4 is deployed (rows minted in between have currency_source NULL and are picked up).
-- KEY: chit_header and chit_detail are keyed (chit_id, entity_id, DIRECTION): one entity holds a sent and a received copy of a chit, each judged on its OWN header and its OWN detail row
--    (join, batch, UPDATE and review rows all carry direction). DB-79 gate, 9 Nov.
-- LOOKED AT (DISCIPLINES 4a): READ-2026-11-09-1-cur1-census.sql buckets (this batch applies the SAME rule, so the census totals predict the batch); lib/mint.js:89 (copies of one chit_id
--    in different currencies = "two documents"); routes/chits.js:687-707 moneyOfInvoice (the key summary_json.money.currency_code).
-- EVIDENCE, in this order: the three places a chit states its own money (business_json.currency, summary_json.currency_code, summary_json.money.currency_code) and the detail rows of
--    the SAME entity copy. It NEVER reads identities.currency_code (plan 3.0: a shop's Country-setup currency counts only where its stamp predates the chit, and no stamp date is
--    recorded where it was read, so such a chit goes to the review list, never a default) and NEVER UPDATEs chit_detail (a legacy detail row stays NULL and is read through its header).
--    The ISO 4217 list check is slice 1 (engines): this file records the code as written; slice 1's strict read refuses any code not on the list, and the census said there are none.
-- WHAT HAPPENS TO EACH CHIT (named, never defaulted):
--    stated                 one code across the chit's three stated places, details silent or equal          → that code,  'backfill_stated', no review row
--    detail                 details agree on one code, nothing stated, no detail row NULL                    → that code,  'backfill_detail', no review row
--    none                   no money at all (a task, a message, a terms round)                               → NULL,       'backfill_none',   no review row
--    stated_disagrees · detail_rows_disagree · detail_vs_stated · detail_partly_null · money_without_currency → NULL,       'backfill_review', a chit_currency_review row with both code lists
--    copies_disagree        (second pass) the copies of one chit_id hold different codes                     → headers keep their own, a review row on every copy
-- ROLL BACK: RUN-2026-11-09-1-cur1-b846-ROLLBACK.sql (its first two statements undo exactly this file; rows the api wrote, source 'stated' / 'setup', are never touched).
-- CHECK (read-only): SELECT currency_source, count(*) FROM chit_header GROUP BY 1 ORDER BY 2 DESC;   Expect NULL only for rows minted since the last run; the buckets equal the census.

WITH batch AS (
  SELECT h.chit_id, h.entity_id, h.direction,
         ARRAY(SELECT DISTINCT v FROM unnest(ARRAY[NULLIF(h.business_json->>'currency',''), NULLIF(h.summary_json->>'currency_code',''),
               NULLIF(h.summary_json->'money'->>'currency_code','')]) v WHERE v IS NOT NULL ORDER BY 1) AS stated,
         ((h.summary_json ? 'money') OR NULLIF(h.summary_json->>'total_value','') IS NOT NULL) AS has_money
  FROM chit_header h WHERE h.currency_source IS NULL
  ORDER BY h.chit_id, h.entity_id, h.direction LIMIT 5000 FOR UPDATE SKIP LOCKED),
ev AS (
  SELECT b.*, d.dcodes, coalesce(d.d_null, false) AS d_null, coalesce(d.d_money, false) AS d_money
  FROM batch b LEFT JOIN LATERAL (
    SELECT ARRAY(SELECT DISTINCT c FROM unnest(array_agg(x.currency_code)) c WHERE c IS NOT NULL ORDER BY 1) AS dcodes,
           bool_or(x.currency_code IS NULL) AS d_null, bool_or(x.total_value <> 0) AS d_money
    FROM chit_detail x WHERE x.chit_id = b.chit_id AND x.entity_id = b.entity_id AND x.direction = b.direction) d ON true),
decided AS (
  SELECT ev.*, CASE
    WHEN cardinality(stated) > 1                                                   THEN 'stated_disagrees'
    WHEN cardinality(coalesce(dcodes,'{}')) > 1                                    THEN 'detail_rows_disagree'
    WHEN cardinality(stated) = 1 AND cardinality(coalesce(dcodes,'{}')) = 1 AND stated[1] <> dcodes[1] THEN 'detail_vs_stated'
    WHEN cardinality(stated) = 1                                                   THEN 'stated'
    WHEN cardinality(coalesce(dcodes,'{}')) = 1 AND NOT d_null                     THEN 'detail'
    WHEN cardinality(coalesce(dcodes,'{}')) = 1                                    THEN 'detail_partly_null'
    WHEN has_money OR d_money                                                      THEN 'money_without_currency'
    ELSE 'none' END AS outcome FROM ev),
review AS (
  INSERT INTO chit_currency_review (chit_id, entity_id, direction, reason, stated_codes, detail_codes)
  SELECT chit_id, entity_id, direction, outcome, stated, dcodes FROM decided WHERE outcome NOT IN ('stated','detail','none')
  ON CONFLICT DO NOTHING)
UPDATE chit_header h
   SET currency_code   = CASE d.outcome WHEN 'stated' THEN d.stated[1] WHEN 'detail' THEN d.dcodes[1] END,
       currency_source = CASE d.outcome WHEN 'stated' THEN 'backfill_stated' WHEN 'detail' THEN 'backfill_detail'
                                        WHEN 'none' THEN 'backfill_none' ELSE 'backfill_review' END
  FROM decided d WHERE h.chit_id = d.chit_id AND h.entity_id = d.entity_id AND h.direction = d.direction;

-- second pass, once the batches report UPDATE 0: copies of one chit_id in different currencies are flagged (each header keeps its own)
INSERT INTO chit_currency_review (chit_id, entity_id, direction, reason, detail_codes)
SELECT h.chit_id, h.entity_id, h.direction, 'copies_disagree', ARRAY[h.currency_code]
FROM chit_header h WHERE h.currency_code IS NOT NULL AND h.chit_id IN
  (SELECT chit_id FROM chit_header WHERE currency_code IS NOT NULL GROUP BY chit_id HAVING count(DISTINCT currency_code) > 1)
ON CONFLICT DO NOTHING;

-- then validate (cheap: SHARE UPDATE EXCLUSIVE, no write lock; a NULL passes both checks)
SET lock_timeout = '5s';   -- fail fast rather than queue behind a long write; a failed VALIDATE changed nothing and is safe to run again
ALTER TABLE chit_header VALIDATE CONSTRAINT chit_header_currency_shape;
ALTER TABLE chit_header VALIDATE CONSTRAINT chit_header_currency_source_chk;

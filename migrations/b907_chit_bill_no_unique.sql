-- b907_chit_bill_no_unique.sql - one counter bill number, one sent bill, per shop: the database itself refuses a second (AB-F-06, walk AB, batch 1129).
--
-- ⚠️ NOT RUN · Athi runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat (IF NOT EXISTS).
-- WHY  two sales with one bill_no and different client_ref were both taken: the till summary counted one, so a sale reached no day sheet and no books. The api now refuses the second in words
--      (409 BILL_NUMBER_TAKEN, lib/bill-number-taken.js, under a per-number lock). This index is the second fence: whatever path writes a chit_header cannot repeat a number.
--      AU, IN and AE law each want a tax invoice number to be unique.
-- WHAT a partial unique index on (entity_id, btrim(bill_no)) for the shop's own sent counter documents (a till stamp, a non-empty bill_no, not a draft). Nothing is changed or deleted.
-- BEFORE YOU RUN (read-only): migrations/READ-2026-11-21-1-bill-no-duplicates.sql must return 0 rows, else this file stops with an error naming the first duplicate and builds nothing.
-- ORDER api first or database first both work: until this runs the api's check alone holds (the lock makes it safe for two staff at once). When it runs, an api that loses a race to the index
--      answers the same 409 BILL_NUMBER_TAKEN (routes/chits.js, the catch).
-- RLS: untouched (an index). ROLL BACK: DROP INDEX IF EXISTS ux_chit_bill_no_per_entity;
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE dup record;
BEGIN
  SELECT entity_id, btrim(business_json ->> 'bill_no') AS bill_no, count(*) AS bills INTO dup
    FROM chit_header
   WHERE sender_entity_id = entity_id AND role <> 'Draft' AND business_json ? 'till' AND btrim(COALESCE(business_json ->> 'bill_no', '')) <> ''
   GROUP BY entity_id, btrim(business_json ->> 'bill_no') HAVING count(*) > 1 LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'b907 not built: shop % holds bill number % on % bills - run READ-2026-11-21-1-bill-no-duplicates.sql and settle each pair first', dup.entity_id, dup.bill_no, dup.bills;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ux_chit_bill_no_per_entity ON public.chit_header USING btree (entity_id, (btrim(business_json ->> 'bill_no')))
  WHERE (sender_entity_id = entity_id AND role <> 'Draft' AND (business_json ? 'till') AND btrim(COALESCE(business_json ->> 'bill_no', '')) <> '');
COMMIT;

-- READ-2026-11-21-1-bill-no-duplicates.sql - READ ONLY. Run this BEFORE b907_chit_bill_no_unique.sql (AB-F-06, walk AB, batch 1129).
-- Lists every shop's counter bill number that sits on more than one sent bill. 0 rows = b907 will create its index. Any row = two sales under one tax invoice number:
-- b907 would refuse to build; fix each pair first (renumber one through the till's renumber path, or set one aside) and run this again.
SELECT entity_id,
       btrim(business_json ->> 'bill_no') AS bill_no,
       count(*)                           AS bills,
       array_agg(chit_id ORDER BY created_at)                          AS chit_ids,
       array_agg(business_json ->> 'client_ref' ORDER BY created_at)   AS client_refs
  FROM chit_header
 WHERE sender_entity_id = entity_id
   AND role <> 'Draft'
   AND business_json ? 'till'
   AND btrim(COALESCE(business_json ->> 'bill_no', '')) <> ''
 GROUP BY entity_id, btrim(business_json ->> 'bill_no')
HAVING count(*) > 1
 ORDER BY entity_id, bill_no;

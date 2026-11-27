-- b912_customer_role_backfill_1138.sql — ONE-CUSTOMER (28 Nov 2026): a supplier the shop has SENT a sales bill is also its customer; file the customer row the old send step skipped.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres: RLS does not apply to the owner, so one run sees every shop), SIT first. Safe to repeat: ON CONFLICT DO NOTHING on
--    (owner_entity_id, customer_identity_id); a second run inserts 0 rows. Adds rows only; nothing is updated or deleted.
-- WHY. Before ACC-new-1 (api PR 1421) lib/chits-send-bill addReceiverToCustomerList skipped the customer row for any receiver already on the sender's supplier list. Such a party is a customer once the
--    shop has sent it an invoice, credit note or debit note (lib/customer-groups: CUSTOMER_ROLE_SQL, SALES_BILLS). New sends file the row; this file files it for the sends already made.
-- WHICH ROWS. For each (shop, party) where the party is on the shop's LIVE supplier list, is not the shop itself, is an identity, and the shop's own SENT copy (chit_header direction 'sent',
--    sent_at set, role not Draft, purpose invoice | credit_note | debit_note) names the party in all_recipients: one customer_list row, customer_type 'entity', added_via 'transaction',
--    txn_count = the sales bills sent, last_txn_at = the latest sent_at. A party already on the customer list (even a hidden row) is left exactly as it is.
-- ROLL BACK (only the rows this file added and nothing has touched since; txn_count is the count it wrote, so a row a later send bumped is kept):
--    DELETE FROM customer_list c WHERE c.added_via = 'transaction' AND c.created_at >= '<the time of the run>' AND c.groups = '{}' AND c.nickname IS NULL;   (review the SELECT form first)
-- CHECK (read-only; true count of suppliers billed but not on the customer list; expect 0 after the run):
--    SELECT count(*) FROM supplier_list sl JOIN chit_header ch ON ch.entity_id = sl.owner_entity_id AND ch.sender_entity_id = sl.owner_entity_id AND ch.direction = 'sent'
--     AND ch.purpose IN ('invoice','credit_note','debit_note') AND ch.sent_at IS NOT NULL AND ch.role <> 'Draft' AND ch.all_recipients @> jsonb_build_array(jsonb_build_object('entity_id', sl.supplier_entity_id::text))
--     WHERE to_jsonb(sl)->>'hidden_at' IS NULL AND sl.supplier_entity_id <> sl.owner_entity_id
--       AND NOT EXISTS (SELECT 1 FROM customer_list c WHERE c.owner_entity_id = sl.owner_entity_id AND c.customer_identity_id = sl.supplier_entity_id);
-- RLS: unchanged (customer_list stays ENABLED + FORCED with its entity policy); each row carries its own shop's owner_entity_id.

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO public.customer_list (owner_entity_id, customer_identity_id, customer_type, added_via, txn_count, last_txn_at)
SELECT sl.owner_entity_id, sl.supplier_entity_id, 'entity', 'transaction', count(DISTINCT ch.chit_id)::int, max(ch.sent_at)
  FROM public.supplier_list sl
  JOIN public.identities i ON i.identity_id = sl.supplier_entity_id
  JOIN public.chit_header ch ON ch.entity_id = sl.owner_entity_id AND ch.sender_entity_id = sl.owner_entity_id AND ch.direction = 'sent'
   AND ch.purpose IN ('invoice', 'credit_note', 'debit_note') AND ch.sent_at IS NOT NULL AND ch.role <> 'Draft'
   AND ch.all_recipients @> jsonb_build_array(jsonb_build_object('entity_id', sl.supplier_entity_id::text))
 WHERE to_jsonb(sl)->>'hidden_at' IS NULL AND sl.supplier_entity_id <> sl.owner_entity_id
 GROUP BY sl.owner_entity_id, sl.supplier_entity_id
ON CONFLICT (owner_entity_id, customer_identity_id) DO NOTHING;

COMMIT;

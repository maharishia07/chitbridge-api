-- b853_connector_receipt_drop_hash_unique.sql — CON-ERP-IDEM (11 Nov 2026), PART 2 of 2: the old one-receipt-per-body unique index goes.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres) AFTER b852, and at least 2 minutes (or one api restart) after b852, so no api instance still writes receipts without idem_key
--    (schema.hasColumn caches a "no" for 60 s). Safe to repeat: DROP INDEX IF EXISTS. Touches no rows.
--
-- WHY. With the key in idem_key, UNIQUE (actor_id, payload_hash) would refuse a second key for the same bytes (the same document sent under another Idempotency-Key or doc_ref). The new unique index
--    connector_receipt_key_idx (b852) is the one guard now. Nothing reads receipts by payload_hash alone, so no replacement index (schema-lint R8 would call it a repeat).
-- RLS: unchanged.
-- ROLL BACK: CREATE UNIQUE INDEX IF NOT EXISTS connector_receipt_idem_idx ON public.connector_receipt (actor_id, payload_hash); (fails if two receipts now share a payload hash under different keys; delete the later one first)

DROP INDEX IF EXISTS connector_receipt_idem_idx;

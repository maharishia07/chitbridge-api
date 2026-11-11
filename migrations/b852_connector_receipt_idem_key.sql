-- b852_connector_receipt_idem_key.sql — CON-ERP-IDEM (11 Nov 2026): a connector receipt is keyed by the caller's own key, not only by the payload bytes. PART 1 of 2 (b853 drops the old index).
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres) after SIT has run it. Safe to repeat: IF NOT EXISTS, backfill only where empty. Run b853 at least 2 minutes (or one api restart) AFTER this.
--
-- WHY. POST /api/connectors/erp-ingest dedupes on UNIQUE (actor_id, payload_hash) today. The door now keys on, in order: the Idempotency-Key header, the document's doc_ref (with its doc_type),
--    then the payload hash. So the key needs its own column and unique index; payload_hash stays as the body's hash (the proof that the same key carries the same body).
--    idem_key holds a sha256 with a one-letter prefix (h: header · d: doc_type+doc_ref · p: payload hash); the raw header and the raw document are never stored.
-- WHY TWO FILES. The api asks schema.hasColumn('connector_receipt','idem_key') and caches a "no" for 60 s. An api instance in that window still writes receipts WITHOUT idem_key, keyed by the old
--    unique index. So this file ONLY ADDS (the column, the backfill, the new unique index); the old unique index stays until b853, once every instance sees the column. Nothing breaks between them.
-- BEFORE THIS RUNS the route works as it did: it keys on the payload hash through the old index (lib/erp-receipt.js asks schema.hasColumn).
-- RLS: connector_receipt stays ENABLED + FORCED; no policy, grant or row other than idem_key changes.
-- ROLL BACK: DROP INDEX IF EXISTS connector_receipt_key_idx; ALTER TABLE public.connector_receipt DROP COLUMN IF EXISTS idem_key;

ALTER TABLE public.connector_receipt ADD COLUMN IF NOT EXISTS idem_key text;

UPDATE public.connector_receipt SET idem_key = 'p:' || payload_hash WHERE idem_key IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS connector_receipt_key_idx ON public.connector_receipt (actor_id, idem_key);

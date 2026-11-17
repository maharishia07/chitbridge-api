-- b215 · STOCK PER BATCH — the balance gains a lot, and FEFO becomes possible
-- ============================================================================================================
-- Athi, 2026-09-10: "batch tracking as a per-product flag, resolved from the vertical."
--
-- b214 keyed a balance by (entity, item, location). That is right for a shop selling soap and wrong for one
-- selling medicine: a recall is BY BATCH, an expiry belongs to a batch and not to a product, and "which of these
-- do I sell first" has no answer when two hundred packets from Tuesday and two hundred from March sit in one pool.
-- lib/lotfields.js said this on the day it was written — "a batch number is not an attribute of Aachi masala
-- 100 g; it is an attribute of the two hundred packets that arrived on Tuesday" — and the movement log has
-- carried a `lot` since b214. This is the balance catching up.
--
-- ── ⭐⭐ IT IS A FORK, NOT A SETTING ──────────────────────────────────────────────────────────────────────────
--   the sector's pack requires batch or serial (pharma · food/FMCG · chemical · electronics) → tracked
--   a product's own item_data.batch_tracked (true|false)                                     → that WINS
-- Both directions have a real shop behind them: a kirana selling loose rice out of one sack does not want a batch
-- on it though FMCG asks for one; a general store with one shelf of medicines needs that shelf tracked though its
-- sector asks for nothing. Resolved by lotfields.tracksBatch(); nothing here decides it.
--
-- ── ⚠️⚠️ EMPTY STRING, NEVER NULL ────────────────────────────────────────────────────────────────────────────
-- A NULL in a primary key does not compare equal to itself, so two untracked balances for one product would be
-- two rows that could never be found, merged, or updated. Untracked stock is held under lot = '' — a real value
-- meaning "one pool" — and the key is uniform whether a product tracks batches or not.
--
-- ⚠️ SAFE NOW BECAUSE BOTH TABLES ARE EMPTY (checked: 0 movements, 0 balances). A primary-key change on live
-- stock would need a backfill and a window; doing it today costs nothing, which is exactly why it is being done
-- today rather than when it is expensive.
--
-- ⚠️ RUN THIS IN THE SUPABASE SQL EDITOR (as `postgres`). Step 1 only looks. Safe to re-run.
-- ============================================================================================================

-- ── 1 · LOOK FIRST. Expect balances = 0; if it is not 0, STOP and tell me — the key change below needs a
--    backfill decision (which lot does existing stock belong to?) that nobody should make silently.
SELECT (SELECT count(*) FROM stock_balance)  AS balances,
       (SELECT count(*) FROM stock_movement) AS movements,
       (SELECT count(*) FROM information_schema.columns
          WHERE table_name = 'stock_balance' AND column_name = 'lot') AS already_done;

-- ── 2 · THE LOT JOINS THE KEY.
BEGIN;

ALTER TABLE stock_balance ADD COLUMN IF NOT EXISTS lot text NOT NULL DEFAULT '';

-- ⚠️ Rebuilding the primary key, not adding a second one. Postgres names it stock_balance_pkey by default; the
--    DO block finds whatever it is actually called, so this works even if it was created under another name.
DO $$
DECLARE pk text;
BEGIN
  SELECT conname INTO pk FROM pg_constraint
   WHERE conrelid = 'stock_balance'::regclass AND contype = 'p';
  IF pk IS NOT NULL THEN EXECUTE format('ALTER TABLE stock_balance DROP CONSTRAINT %I', pk); END IF;
  ALTER TABLE stock_balance ADD PRIMARY KEY (entity_id, item_id, location, lot);
  RAISE NOTICE 'b215: stock_balance is now keyed per batch. Untracked stock lives under lot = the empty string.';
END $$;

-- ⚠️⚠️ THE IDEMPOTENCY KEY GAINS THE LOT TOO, and it has to. One sale line can draw from TWO batches under FEFO
-- (five units: three from the batch expiring Friday, two from the next), which is two movements sharing one
-- line_ref. Without the lot in this index the second one would be rejected as a duplicate and the sale would be
-- short by two units, silently.
-- COALESCE, not the bare column: NULLs do not collide in a unique index, so a NULL lot would defeat the whole
-- point of it — a replayed bill for untracked stock would post twice.
DROP INDEX IF EXISTS uq_stock_movement_once;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movement_once
  ON stock_movement (entity_id, ref, line_ref, reason, COALESCE(lot, '')) WHERE ref IS NOT NULL;

-- ⚠️ THE EXPIRY LIVES ON THE BALANCE, NOT ONLY ON THE MOVEMENT. FEFO sorts batches by date on every tracked sale,
-- and deriving that from the receipts each time would mean reading a product's whole movement history to sell one
-- strip of tablets. It is captured once, when the batch first arrives, and never changes — a batch's expiry is
-- printed on the pack and is not ours to edit.
-- ⚠️ THE COLUMN COMES BEFORE THE INDEX THAT USES IT. It did not, in the first cut of this file: the FEFO index was
-- in this step and the column two steps later, so the whole migration would have failed on a fresh run. A file
-- that has only ever been read is not a file that is known to work.
ALTER TABLE stock_balance  ADD COLUMN IF NOT EXISTS expires_at date;
ALTER TABLE stock_movement ADD COLUMN IF NOT EXISTS expires_at date;

-- FEFO reads "this product, this location, oldest expiry first, still holding stock" on every tracked sale
CREATE INDEX IF NOT EXISTS idx_stock_balance_fefo
  ON stock_balance (entity_id, item_id, location, expires_at NULLS LAST) WHERE qty > 0;

COMMIT;

-- ── 3 · PROVE IT.
SELECT string_agg(column_name, ', ' ORDER BY ordinal_position) AS stock_balance_columns
FROM information_schema.columns WHERE table_name = 'stock_balance';

SELECT conname AS primary_key,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid = 'stock_balance'::regclass AND contype = 'p';

SELECT indexname, indexdef FROM pg_indexes
WHERE tablename IN ('stock_movement', 'stock_balance') ORDER BY indexname;

-- ── AFTERWARDS: a pharmacy or an FMCG shop keeps a balance per batch and sales draw down FEFO — first EXPIRED
--    out, not first in. A general-trade shop is unchanged: everything sits under lot = '' exactly as before.
--    The till still shows no stock (Athi's v1 call), so nothing on any screen changes.

-- b214 · STOCK — the movement log, and the consolidated number Athi asked for
-- ============================================================================================================
-- Athi, 2026-09-10: "we do not want to calculate from every chit, a consolidated number during every write may
-- have to be maintained, this means there may be offline capability as well." Then, on the design note:
-- "weighted average first, one location, till doesn't show stock in v1."
--
-- Design: C:\dev\INVENTORY-LIFECYCLE.md. This is the first slice of it — opening balance, movements with reason
-- codes, and a running balance. No FIFO layers, no ATP, no NRV beyond a write-down movement.
--
-- ── ⭐⭐ TWO TABLES, AND THE RELATIONSHIP BETWEEN THEM IS THE WHOLE DESIGN ────────────────────────────────────
--   stock_movement   the LOG.   Append-only by GRANT. This is the truth.
--   stock_balance    the CACHE. Moved in the SAME transaction as the movement. Rebuildable from the log.
--
-- If they ever disagree, THE LOG WINS. That claim is only worth making if it can be checked, so
-- `lib/stock-store.js` ships a rebuild() and tests/stock-cycle proves a replay lands where the balance is.
-- A consolidated number nobody can rebuild is a number nobody can defend.
--
-- ⚠️⚠️ THE BALANCE IS MOVED WITH ARITHMETIC IN SQL — `SET qty = qty + $delta`, never read-then-write in the
-- application. Two counters selling the last packet at the same moment is not a rare case in a shop; it is
-- Saturday. A read-modify-write in JS loses one of them, silently, and the shelf is the only place it shows up.
--
-- ── ⚠️ WHY THERE IS A `location` COLUMN WHEN v1 HAS ONE LOCATION ──────────────────────────────────────────────
-- Athi chose one location, and v1 always writes 'default'. The column exists anyway because the design note warned
-- that retrofitting a second location is not cheap: it changes the identity of every balance row, so it would mean
-- a backfill plus a primary-key change on live data. One column with a default costs nothing today and turns that
-- into a feature rather than a migration. It is NOT a claim that locations work — nothing reads it yet.
--
-- ⭐ WITH RLS — entity-isolated on app.current_entity, ENABLE + FORCE, like every other entity-data table.
--
-- ⚠️ RUN THIS IN THE SUPABASE SQL EDITOR (as `postgres`). `railway run … scripts/sql.cjs` connects as cb_app,
-- which owns nothing and cannot CREATE or GRANT — see HOW-TO-LOGIN.md. Step 1 only looks. Safe to re-run.
-- ============================================================================================================

-- ── 1 · LOOK FIRST. Expect 0 rows the first time.
SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('stock_movement', 'stock_balance')
ORDER BY c.relname;

-- ── 2 · THE LOG.
BEGIN;

CREATE TABLE IF NOT EXISTS stock_movement (
  movement_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL,
  item_id       uuid NOT NULL,
  location      text NOT NULL DEFAULT 'default',

  -- ⚠️ SIGNED, and the sign is DERIVED FROM THE REASON by lib/inventory.js, never taken from a caller. A sale that
  -- arrived with a positive quantity would otherwise ADD stock and look like an ordinary row.
  qty           numeric(18,3) NOT NULL,
  -- cost per unit, inbound only. ⚠️ EXCLUDES refundable tax — Ind AS 2, and what RCV-07 already asserts.
  rate          numeric(18,4),
  -- a write-down moves money without moving quantity (Ind AS 2: lower of cost and net realisable value)
  value_delta   numeric(18,2),

  reason        text NOT NULL,
  -- what caused it: the bill number, the GRN, the count sheet. The SAME client_ref the chit carries.
  ref           text,
  line_ref      text,                       -- which line of that document, so one bill may move two products
  lot           text,                       -- batch/expiry key, for when FEFO arrives; nothing reads it in v1
  note          text,
  at            timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,

  CONSTRAINT stock_movement_reason_chk CHECK (reason IN (
    'opening','purchase','sale_return','purchase_return','sale',
    'damage','expiry','theft','sample','count_adjust','writedown')),
  -- ⚠️ a movement of nothing records nothing — except a write-down, which is money only
  CONSTRAINT stock_movement_qty_chk CHECK (qty <> 0 OR reason = 'writedown'),
  CONSTRAINT stock_movement_rate_chk CHECK (rate IS NULL OR rate >= 0)
);

-- ⚠️⚠️ A BILL THAT SYNCS TWICE MUST NOT MOVE STOCK TWICE. The counter bills offline and replays its queue as a
-- matter of routine, so the same document arrives more than once by design — chits handle it by client_ref and
-- the reward ledger proved the pattern. One movement per (shop, document, line, reason).
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_movement_once
  ON stock_movement (entity_id, ref, line_ref, reason) WHERE ref IS NOT NULL;

-- the rebuild reads one product's whole history in timestamp order; the report reads a period
CREATE INDEX IF NOT EXISTS idx_stock_movement_item
  ON stock_movement (entity_id, item_id, location, at);
CREATE INDEX IF NOT EXISTS idx_stock_movement_at ON stock_movement (entity_id, at);

-- ── 3 · THE CONSOLIDATED NUMBER.
CREATE TABLE IF NOT EXISTS stock_balance (
  entity_id     uuid NOT NULL,
  item_id       uuid NOT NULL,
  location      text NOT NULL DEFAULT 'default',

  qty           numeric(18,3) NOT NULL DEFAULT 0,
  value         numeric(18,2) NOT NULL DEFAULT 0,
  -- ⚠️ KEPT WHEN QUANTITY REACHES ZERO. The average is then undefined, and the next sale before the next delivery
  -- still has to be valued at something; "what it last cost" is the only honest answer available.
  avg_cost      numeric(18,4) NOT NULL DEFAULT 0,

  -- ⭐ THE AGE OF THE NUMBER, which the shopkeeper reads as much as the number. A quantity with no timestamp is a
  -- claim nobody can weigh.
  last_at       timestamptz,
  moves         bigint NOT NULL DEFAULT 0,       -- how many movements are folded in — a rebuild checks against it
  updated_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (entity_id, item_id, location)
);

-- ── 4 · ISOLATION AND PRIVILEGE.
ALTER TABLE stock_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movement FORCE  ROW LEVEL SECURITY;
ALTER TABLE stock_balance  ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_balance  FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rls_entity ON stock_movement;
CREATE POLICY rls_entity ON stock_movement
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

DROP POLICY IF EXISTS rls_entity ON stock_balance;
CREATE POLICY rls_entity ON stock_balance
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

-- ⭐⭐ APPEND-ONLY BY GRANT, exactly as the reward ledger is. A movement is a claim about what physically
-- happened; a claim you can edit is not a record, it is a draft. A mistake is corrected by posting the opposite
-- movement — which is what `count_adjust` is for, and it leaves both the error and the correction readable.
GRANT SELECT, INSERT ON stock_movement TO cb_app;
REVOKE UPDATE, DELETE ON stock_movement FROM cb_app;

-- ⚠️ THE BALANCE, BY CONTRAST, IS UPDATABLE — it is a cache, and caches move. That asymmetry IS the design: the
-- thing that can be edited is the thing that can be thrown away and rebuilt.
GRANT SELECT, INSERT, UPDATE ON stock_balance TO cb_app;
REVOKE DELETE ON stock_balance FROM cb_app;

DO $$
BEGIN
  RAISE NOTICE 'b214: stock_movement is append-only; stock_balance is a rebuildable cache. If they disagree, the log wins.';
  RAISE NOTICE 'b214: v1 is weighted average, one location, and the till does not show stock.';
END $$;

COMMIT;

-- ── 5 · PROVE IT. Expect two tables, both forced, one policy each.
SELECT c.relname AS table_name, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('stock_movement', 'stock_balance')
ORDER BY c.relname;

-- ⚠️ And check the grants read the way this file claims: movement = SELECT+INSERT, balance = +UPDATE.
SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS cb_app_may
FROM information_schema.role_table_grants
WHERE grantee = 'cb_app' AND table_name IN ('stock_movement', 'stock_balance')
GROUP BY table_name ORDER BY table_name;

-- ── AFTERWARDS: nothing changes on any screen. v1 records movements and maintains the balance; the counter does
--    not display stock (Athi's call), so this is groundwork you verify with a query rather than with your eyes:
--      railway run --service chitbridge-api -- node scripts/sql.cjs -e "SELECT * FROM stock_balance" --entity <shop> --write

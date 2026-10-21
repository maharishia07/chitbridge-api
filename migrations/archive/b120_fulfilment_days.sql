-- b120_fulfilment_days.sql — how quickly a store can actually send something.
--
-- Athi, 2026-08-08: *"do the fulfilment routes so we get the days, complete this journey."*
--
-- The locator can already say WHO has it and HOW FAR away they are. It cannot say WHEN, and a distance is not a
-- date: 91 km is next-day by road and three weeks if it needs an export licence.
--
-- ── DECLARED, NEVER COMPUTED ──────────────────────────────────────────────────────────────────────────────────
-- The tempting design is to derive days from distance — km ÷ some assumed speed. That produces a plausible number
-- for every store, including the ones nobody has asked, and a plausible wrong date is exactly what this whole
-- availability path exists to avoid. So each store DECLARES its own days, and a store that has not declared them
-- says "not declared" rather than being handed an average.
--
--   dispatch_days      from the moment an order arrives to the moment goods leave this store. 0 = same day.
--   ship_within_days   transit to a customer INSIDE its service radius (b119 service_km).
--   ship_beyond_days   transit to a customer outside it. Often much larger — a different lane, not a longer drive.
--
-- Three numbers rather than a route table on purpose: a per-pair matrix is O(stores²) to maintain and nobody keeps
-- it current, so it decays into confident nonsense. Two bands a store actually knows are worth more than a matrix
-- it does not.
--
-- NULL means NOT DECLARED, which is a real answer and must survive to the screen. Zero means same-day.
--
-- Safe to re-run.
-- Rollback:  ALTER TABLE identities DROP COLUMN dispatch_days, DROP COLUMN ship_within_days, DROP COLUMN ship_beyond_days;

ALTER TABLE identities ADD COLUMN IF NOT EXISTS dispatch_days     smallint;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS ship_within_days  smallint;
ALTER TABLE identities ADD COLUMN IF NOT EXISTS ship_beyond_days  smallint;

COMMENT ON COLUMN identities.dispatch_days IS
  'Days from order to goods leaving this store. 0 = same day. NULL = not declared, which is not the same as 0.';
COMMENT ON COLUMN identities.ship_within_days IS
  'Transit days to a customer inside service_km. NULL = not declared.';
COMMENT ON COLUMN identities.ship_beyond_days IS
  'Transit days to a customer beyond service_km — usually a different lane, not a longer drive. NULL = not declared.';

-- h3_force_rls_draft.sql — DRAFT for Athi, NOT RUN. FORCE ROW LEVEL SECURITY on four tables.
--
-- ⚠️⚠️ FINDING (2026-09-28): b101 ALREADY SAYS THIS FOR THREE OF THEM, AND PRODUCTION DOES NOT HAVE IT.
-- migrations/b101_ai_security_hardening.sql (July) does `ALTER TABLE entity_profile / entity_wallet / usage_ledger
-- FORCE ROW LEVEL SECURITY`, REVOKEs cb_app's writes on entity_wallet (the money table), and adds the platform-wide
-- AI ceiling. db/rls-baseline.json — read from the LIVE database on 2026-09-26 — shows all three "forced": false.
-- So b101 was most likely never applied (lib/ai.js even says "fn missing (pre-b101) → skip global check": the
-- ceiling has been silently skipped). Confirm with step 0 below; if so, the cleanest fix is to RUN b101 IN FULL
-- (it is written additive + idempotent) and then this file's ai_usage line.
--
-- WHO READS AND WRITES THEM — every statement runs inside withEntity(<the row's own entity>), so FORCE changes
-- nothing for the app (checked 2026-09-28, file:line):
--   entity_profile  adopt.js:59 · chits.js:529 · till.js:151 · profile.js:103,131,150(readBatch sets the entity),166
--                   · stock-from-chit.js:175 — all withEntity(entity_id) / readBatch(entity_id)
--   entity_wallet   ai.js:417,449 — reads, withEntity(entity_id). No writes from cb_app (b101 revokes them anyway;
--                   top-ups go through the SECURITY DEFINER wallet_topup()).
--   usage_ledger    ai.js:415,438,446,447 · kyb.js:256 · meter.js:63 · entities.js:1454–1475 — all withEntity(<own>)
--   ai_usage        NO statement in routes/lib/middleware reads or writes it. Forcing it cannot break the app.
-- ⇒ SAFE TO FORCE WITH TONIGHT'S CODE AS IT IS. No code change was needed.
--
-- ── 0 · BEFORE: is b101 in? and the census to compare against ───────────────────────────────────────────────
SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS policies
  FROM pg_class c
 WHERE c.relname IN ('ai_usage', 'entity_profile', 'entity_wallet', 'usage_ledger') ORDER BY 1;
SELECT has_table_privilege('cb_app', 'entity_wallet', 'INSERT') AS app_can_write_wallet;   -- b101 makes this false
SELECT count(*) AS b101_functions FROM pg_proc WHERE proname = 'wallet_topup';           -- b101 makes this 1
SELECT (SELECT count(*) FROM ai_usage) AS ai_usage_rows, (SELECT count(*) FROM entity_profile) AS profiles,
       (SELECT count(*) FROM entity_wallet) AS wallets, (SELECT count(*) FROM usage_ledger) AS ledger_rows;

-- ── 1 · EITHER run migrations/b101_ai_security_hardening.sql in full (preferred if step 0 shows it missing),
--       then step 2 below. OR, for the FORCE alone: ───────────────────────────────────────────────────────────
BEGIN;
ALTER TABLE entity_profile FORCE ROW LEVEL SECURITY;
ALTER TABLE entity_wallet  FORCE ROW LEVEL SECURITY;
ALTER TABLE usage_ledger   FORCE ROW LEVEL SECURITY;
-- ── 2 · the fourth, not in b101 ──────────────────────────────────────────────────────────────────────────────
ALTER TABLE ai_usage       FORCE ROW LEVEL SECURITY;
COMMIT;

-- ── 3 · AFTER: all four forced; the row counts (as the owner) unchanged; the app sees one shop at a time ─────
SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
  FROM pg_class c WHERE c.relname IN ('ai_usage', 'entity_profile', 'entity_wallet', 'usage_ledger') ORDER BY 1;
SET ROLE cb_app;
SELECT count(*) AS profiles_visible_with_no_shop FROM entity_profile;                      -- expect 0
SELECT set_config('app.current_entity', (SELECT entity_id::text FROM entity_profile LIMIT 1), false);
SELECT count(DISTINCT entity_id) AS shops_seen FROM entity_profile;                        -- expect 1
RESET ROLE;
SELECT set_config('app.current_entity', '', false);
-- then on the live app: open a shop's profile, send an AI draft (usage_ledger write), open Settings › Usage.

-- ── 4 · ROLLBACK (per table) ─────────────────────────────────────────────────────────────────────────────────
-- ALTER TABLE <t> NO FORCE ROW LEVEL SECURITY;

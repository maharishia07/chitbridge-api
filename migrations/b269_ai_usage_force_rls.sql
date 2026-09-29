-- b269_ai_usage_force_rls.sql — RUN BY ATHI 2026-09-29 (Supabase editor).
-- The fourth table with row-level security switched on but not forced (critic/triage H3). b101 — also run by Athi on
-- 2026-09-29, after the night's check found it had never been applied — forces entity_profile, entity_wallet and
-- usage_ledger; it does not cover ai_usage. Nothing in routes/lib/middleware reads or writes ai_usage, so forcing it
-- cannot change what the app sees. Verified after: all four tables forced = true.
-- ⚠️ ENABLE is stated too, though Athi ran only the FORCE: production already had it enabled with one policy
-- (db/rls-baseline.json, read live 2026-09-26: rls true, policies 1), but no migration file ever said so — and FORCE
-- without ENABLE does nothing (tests/entity-cast-guard.test.cjs). Idempotent: on production it changes nothing.
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage FORCE ROW LEVEL SECURITY;

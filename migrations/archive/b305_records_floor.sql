-- b305_records_floor.sql — round CO3 (2026-10-13): NO COPY OF A BUSINESS RECORD EXPIRES BEFORE RECORDS LAW ALLOWS.
--   The schema default for chit_status.retention_expires_at was now() + 90 days (000_baseline; b105 repeated it). Records law asks
--   for years: IN Companies Act s.128(5) eight financial years + CGST s.36 72 months · AU TAA Sch 1 s.382-5 5 y, Corporations Act
--   s.286 7 y · AE TPL 5 y, CT DL 47/2022 Art.56 7 y. Counted from the mint, the longest is 9 years — lib/policy.js
--   RECORDS_FLOOR_YEARS, the ONE figure (the mint `retainDaysFor` and the sweep `planRetirement` read it; this file mirrors it).
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — ALTER COLUMN needs the table owner; cb_app cannot).
--    Written offline, never executed here. Safe to re-run: the default is SET (same value twice), the backfill is GREATEST (a second
--    run matches nothing it would change), and every step on retire_at checks the column exists (b105 may not have run).
--    Until it runs nothing breaks and nothing is lost: nothing deletes (lib/retention.js commit is not wired), the mint already writes
--    9 years on every new copy (routes/chits.js), and the planner refuses any copy younger than 9 years whatever its retire_at says.
--
-- RLS: unchanged — no table, no policy, no grant. Run AS postgres so the backfill reaches every shop's copies.
-- ONLY LENGTHENS: GREATEST(old, created_at + 9 years). No date is ever moved earlier; no row is deleted; no money is touched.

-- ── 1 · LOOK FIRST (changes nothing): how many copies would be lengthened ─────────────────────────────────────────────────
SELECT count(*) AS copies_to_lengthen
  FROM chit_status
 WHERE created_at IS NOT NULL AND retention_expires_at < created_at + interval '9 years';

-- ── 2 · the default and the backfill ──────────────────────────────────────────────────────────────────────────────────────
BEGIN;
ALTER TABLE chit_status ALTER COLUMN retention_expires_at SET DEFAULT (now() + interval '9 years');
UPDATE chit_status SET retention_expires_at = created_at + interval '9 years'
 WHERE created_at IS NOT NULL AND retention_expires_at < created_at + interval '9 years';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'chit_status' AND column_name = 'retire_at') THEN
    EXECUTE $q$UPDATE chit_status SET retire_at = created_at + interval '9 years'
                WHERE created_at IS NOT NULL AND retire_at IS NOT NULL AND retire_at < created_at + interval '9 years'$q$;
  END IF;
END $$;
COMMIT;

-- ── PROOFS (re-run any time; an auditor may run them too) ─────────────────────────────────────────────────────────────────
-- P1 · expect 0: no copy expires inside the floor
SELECT count(*) AS inside_floor FROM chit_status
 WHERE created_at IS NOT NULL AND retention_expires_at < created_at + interval '9 years';
-- P2 · expect a default containing '9 years'
SELECT column_default FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'chit_status' AND column_name = 'retention_expires_at';
-- P3 · Rule 3(1) edit trail cannot be switched off — expect 5 rows, every tgenabled = 'O' (enabled): books_insert_only on four,
--      books_payment_guard on books_payment (b295: only the two advice columns may be filled once; money columns stay sealed)
SELECT c.relname AS books_table, t.tgname, t.tgenabled, p.proname
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
 WHERE NOT t.tgisinternal AND p.proname IN ('books_insert_only','books_payment_guard')
 ORDER BY 1;
-- P4 · expect 0 rows: the app role holds no table-wide UPDATE / DELETE on the books, and does not own them (only an owner can disable a trigger)
SELECT table_name, privilege_type FROM information_schema.role_table_grants
 WHERE grantee = 'cb_app' AND privilege_type IN ('UPDATE','DELETE')
   AND table_name IN ('journal_entry','journal_line','party_item','books_payment','books_change_log')
UNION ALL
SELECT tablename, 'OWNER' FROM pg_tables
 WHERE tableowner = 'cb_app' AND tablename IN ('journal_entry','journal_line','party_item','books_payment','books_change_log');

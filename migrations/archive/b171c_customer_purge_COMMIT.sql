-- b171c — THE REAL ONE. THIS COMMITS. There is no undo.
--
-- Run b171b first (it simulates and rolls back). Athi did, on 2026-08-20, and approved this shape:
--
--     chit_detail    . entity_id             50
--     chit_header    . entity_id             50
--     chit_status    . entity_id             50
--     customer_list  . customer_identity_id  50
--     state_log      . entity_id             50
--     customers_remaining 0 · entities 1218 · actors 412
--
-- ⚠️⚠️ I READ THAT AS "50 CUSTOMERS" AND IT IS NOT. Those are DEPENDENT ROW counts — 50 orders. The customer
-- count was only ever in a RAISE NOTICE, which the Supabase editor does not display, so the one number this
-- guard depended on was the one number invisible on screen. EXPECTED was set from a column that meant
-- something else, and the abort that followed looked exactly like a data change.
--
-- The truth, from b171d: 71 customers holding 50 orders between them — 21 signed up and never ordered. Every
-- one is buyer-<timestamp>@test-cb.com under Alpha Paints or Gamma Exports, created in bursts on 16 August.
-- Nothing arrived between the simulation and the commit. There was never a data change.
--
-- ⭐ SO THE COUNT IS NOW A ROW IN THE RESULT SET. A guard whose input cannot be seen is not a guard.
--
-- ⚠️ IT ABORTS IF THE CUSTOMER COUNT IS NO LONGER 71. If it moves between now and the run, something added
-- customers — a storefront order, a test suite, another session. The approval is for the 71 verified above,
-- not a blank cheque for whatever is there later. Raise the number only after looking at b171d again.
--
-- ⚠️ It is a SEPARATE FILE rather than b171b with the last line changed, so b171b stays permanently safe to
-- run and nobody reaches for a destructive script by muscle memory.
--
-- ── RLS ────────────────────────────────────────────────────────────────────────────────────────────────────
--   identities                      WITHOUT RLS  — the deliberate b54 cross-tenant carve-out
--   every dependent deleted below   WITH RLS     — chit_*, state_log, customer_list, catalogue_items…
--   access_events, entity_profile   WITH RLS, FORCEd
-- This script does not set app.entity_id and must not — it is deliberately cross-entity, and relies on running
-- as a role that bypasses RLS, which the Supabase SQL editor does.

BEGIN;

CREATE TEMP TABLE _cust ON COMMIT DROP AS
  SELECT identity_id FROM identities WHERE identity_type = 'customer';

CREATE TEMP TABLE _purged (tbl text, col text, rows_removed bigint) ON COMMIT DROP;

DO $$
DECLARE
  r      record;
  n      bigint;
  ncust  bigint;
  EXPECTED constant bigint := 71;   -- verified by b171d: 71 customers, all buyer-*@test-cb.com, created 16 Aug
BEGIN
  SELECT count(*) INTO ncust FROM _cust;

  IF ncust = 0 THEN
    RAISE EXCEPTION 'Nothing to do: there are no customers. Already purged?';
  END IF;

  IF ncust <> EXPECTED THEN
    RAISE EXCEPTION
      'ABORTED — % customers found, but % were approved in the simulation. The data changed since you looked. Re-run b171b, read it again, then update EXPECTED here if the new number is intended.',
      ncust, EXPECTED;
  END IF;

  /* Every FK pointing at identities, asked of the database rather than hand-listed — a hand-written list
     missed state_log the first time, and would have missed the six FKs declared inline in CREATE TABLE too. */
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid = 'identities'::regclass
       AND c.conrelid <> 'identities'::regclass
     ORDER BY 1, 2
  LOOP
    EXECUTE format('DELETE FROM %s WHERE %I IN (SELECT identity_id FROM _cust)', r.tbl, r.col);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN INSERT INTO _purged VALUES (r.tbl, r.col, n); END IF;
  END LOOP;

  /* Self-references are NULLED, never deleted — deleting the referencing row would delete an ENTITY. */
  FOR r IN
    SELECT a.attname AS col
      FROM pg_constraint c
      JOIN unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid = 'identities'::regclass
       AND c.conrelid  = 'identities'::regclass
  LOOP
    EXECUTE format('UPDATE identities SET %I = NULL WHERE %I IN (SELECT identity_id FROM _cust)', r.col, r.col);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN INSERT INTO _purged VALUES ('identities (nulled)', r.col, n); END IF;
  END LOOP;
END $$;

DELETE FROM identities WHERE identity_type = 'customer';

-- One result set — the editor shows only the last.
SELECT * FROM (
        SELECT 1 AS ord, 'DELETED' AS section, tbl AS detail, col AS column_name, rows_removed AS n
          FROM _purged
  UNION ALL
        /* ⭐ THE NUMBER THE GUARD ACTUALLY CHECKS, on screen where it can be read. */
        SELECT 2, 'CUSTOMERS REMOVED', 'identities (customer)', '', (SELECT count(*) FROM _cust)
  UNION ALL
        SELECT 3, 'AFTER — must be 0',         'customers_remaining', '',
               (SELECT count(*) FROM identities WHERE identity_type = 'customer')
  UNION ALL
        SELECT 4, 'AFTER — must be unchanged', 'entities_untouched',  '',
               (SELECT count(*) FROM identities WHERE identity_type = 'entity')
  UNION ALL
        SELECT 5, 'AFTER — must be unchanged', 'actors_untouched',    '',
               (SELECT count(*) FROM identities WHERE identity_type = 'actor')
) x
ORDER BY ord, n DESC, detail;

COMMIT;

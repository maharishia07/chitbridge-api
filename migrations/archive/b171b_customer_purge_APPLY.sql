-- b171b — APPLY. This DELETES. Run b171a_customer_purge_DRYRUN.sql first.
--
-- Athi, 2026-08-20: *"We can remove the old customer details, we are in testing phase, just drop them down."*
--
-- ⚠️⚠️ THE FIRST VERSION OF THIS FILE FAILED, AND THE REASON MATTERS MORE THAN THE FIX:
--
--     ERROR: 23503: update or delete on table "identities" violates foreign key constraint
--            "state_log_entity_id_fkey" on table "state_log"
--
-- I had hand-listed the dependent tables from a grep I truncated with `head -14`, and treated the truncated
-- output as the complete set. `state_log` was below the cut. There are in fact 24 foreign keys to identities
-- added by ALTER and six more declared inline inside CREATE TABLE — which a grep for "ALTER TABLE … REFERENCES"
-- also misses.
--
-- ⭐⭐ SO THIS NO LONGER LISTS THEM. It asks the database. pg_constraint knows every foreign key pointing at
-- identities, including ones added by migrations that do not exist yet. A hand-written list is a snapshot of
-- what one person could see on one afternoon; this cannot be incomplete, and it cannot go stale.
--
-- ⚠️ IT DELETES EVERY CUSTOMER AND EVERYTHING ATTACHED — orders, lines, statuses, messages, disputes, activity.
-- Not because that is desirable but because none of those foreign keys cascade. There is no version of this
-- that keeps the orders.
--
-- ⚠️ ENTITIES AND CO-ASSISTS ARE NEVER TOUCHED. Every generated statement is scoped to the customer set.
--
-- ⚠️⚠️ IT ENDS IN ROLLBACK. Run it, read the single result table, then change the last line to COMMIT
-- and run again. A destructive migration that commits on its first run gives you nothing to reconsider.
--
-- ── RLS ────────────────────────────────────────────────────────────────────────────────────────────────────
-- MIXED, and the mix matters here:
--
--   identities                          WITHOUT RLS  — the deliberate b54 cross-tenant carve-out
--   every dependent deleted below       WITH RLS     — chit_*, state_log, customer_list, catalogue_items…
--   access_events, entity_profile       WITH RLS, FORCEd — applies to the table OWNER as well
--
-- ⚠️ THIS SCRIPT DOES NOT SET app.entity_id, and it must not: it is deliberately cross-entity. It therefore
-- relies on running as a role that bypasses RLS — which the Supabase SQL editor does.
--
-- ⚠️⚠️ THE TELL IF IT EVER DOES NOT: every NOTICE reports 0 rows while customers plainly exist. Each policy
-- would be evaluating against a null entity id, matching nothing, and reporting success — and then the final
-- DELETE FROM identities, which is NOT filtered, would fail on the same foreign keys all over again. Zero
-- everywhere is not an empty database; it is a silent filter.

BEGIN;

CREATE TEMP TABLE _cust ON COMMIT DROP AS
  SELECT identity_id FROM identities WHERE identity_type = 'customer';

/**
 * ⚠️⚠️ RAISE NOTICE IS INVISIBLE IN THE SUPABASE SQL EDITOR. The first version reported every table and row
 * count as a NOTICE so the deletion would be legible rather than a silent sweep — and Athi saw none of it,
 * because that editor returns result sets and drops notices on the floor.
 *
 * Same class of mistake as echo two files ago: an assumption about the environment that only surfaced when
 * he ran it. So the counts now go into a TABLE and are SELECTed at the end, where they cannot be missed.
 */
CREATE TEMP TABLE _purged (tbl text, col text, rows_removed bigint) ON COMMIT DROP;

DO $$
DECLARE
  r        record;
  n        bigint;
  total    bigint := 0;
  ncust    bigint;
BEGIN
  SELECT count(*) INTO ncust FROM _cust;
  RAISE NOTICE 'customers to remove: %', ncust;

  /* Every FK pointing at identities, from any table other than identities itself. Self-references are handled
     separately below, because a customer's parent_entity_id points at a SHOP that must survive. */
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
    IF n > 0 THEN
      INSERT INTO _purged VALUES (r.tbl, r.col, n);
      total := total + n;
    END IF;
  END LOOP;

  /* ⚠️ SELF-REFERENCES ARE NULLED, NOT DELETED. identities.delegate_actor_id and friends may point at a row we
     are removing; deleting the referencing row would delete an ENTITY. Clearing the pointer is the only correct
     move — and in practice these never point at a customer, so this should report nothing. */
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

  RAISE NOTICE 'dependent rows removed: %', total;
END $$;

DELETE FROM identities WHERE identity_type = 'customer';

/**
 * ⚠️⚠️ ONE RESULT SET, NOT TWO. The Supabase editor shows only the LAST result of a multi-statement run — so
 * the first version's two SELECTs meant the per-table detail scrolled into oblivion and Athi saw only the
 * summary. Third time today that an assumption about that editor was wrong (after \echo and RAISE NOTICE),
 * so this stops assuming and returns everything in a single table.
 *
 * Read the WHAT WENT rows before committing: they are the only record of what a COMMIT destroys.
 */
SELECT * FROM (
        SELECT 1 AS ord, 'WHAT WENT'  AS section, tbl AS detail, col AS column_name, rows_removed AS n
          FROM _purged
  UNION ALL
        SELECT 2, 'AFTER — must be 0',         'customers_remaining', '',
               (SELECT count(*) FROM identities WHERE identity_type = 'customer')
  UNION ALL
        SELECT 3, 'AFTER — must be unchanged', 'entities_untouched',  '',
               (SELECT count(*) FROM identities WHERE identity_type = 'entity')
  UNION ALL
        SELECT 4, 'AFTER — must be unchanged', 'actors_untouched',    '',
               (SELECT count(*) FROM identities WHERE identity_type = 'actor')
) x
ORDER BY ord, n DESC, detail;

-- ⚠️ CHANGE THIS TO COMMIT ONLY AFTER READING THE ROWS ABOVE.
ROLLBACK;

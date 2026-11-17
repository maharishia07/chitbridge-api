-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b239 — TWO CHECK CONSTRAINTS ON ONE COLUMN. Drop both, add one.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi hit this running b238:
--
--     ERROR 23514: new row for relation "identities" violates check constraint "identities_supplies_check"
--
-- ── ⚠️⚠️ TWO CONSTRAINTS, TWO NAMES, SAME COLUMN ───────────────────────────────────────────────────────────────
--
--     identities_supplies_check   goods · services · both                      postgres auto-named it when the
--                                                                              column was first defined
--     identities_supplies_chk     goods · service · both · none · unknown      b237, mine
--
-- ⚠️ POSTGRES APPLIES BOTH. A row must satisfy every CHECK on the table, so the only values that could be
-- written were the INTERSECTION — 'goods' and 'both'. 'services' failed mine, 'none' and 'unknown' failed the
-- original, and 'service' failed the original too.
--
-- ⭐⭐ SO b237 BROKE A WORKING FEATURE. Before it, a shop could choose goods/services/both and the profile
-- screen saved it — that is how `Chola Auto Care` came to be 'both'. After it, only two of the three still
-- worked, and nothing said so: the validator accepted 'services' and the database refused it.
--
-- ── ⭐ THE LESSON, AND IT IS NOT "CHECK FOR CONSTRAINTS" ───────────────────────────────────────────────────────
--
-- b238 dropped `identities_supplies_chk` by name and believed that was the set. The real mistake was earlier:
-- b237 ADDED a constraint to a column it had not looked at, on the assumption that it was creating the column.
-- `ADD COLUMN IF NOT EXISTS` silently did nothing, and `ADD CONSTRAINT` — which has no IF NOT EXISTS — happily
-- added a second rule beside one nobody had read.
--
-- ⚠️ `_chk` and `_check` are eight characters apart and mean the same thing to a reader. A DROP by exact name
-- cannot be trusted to have found everything; this file drops by WHAT THE CONSTRAINT SAYS instead.
--
-- Supabase → SQL Editor → SELECT ALL → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1 · drop EVERY check constraint that mentions this column, whatever it is called
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'identities'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%supplies%'
  LOOP
    EXECUTE format('ALTER TABLE identities DROP CONSTRAINT %I', r.conname);
    RAISE NOTICE 'dropped %', r.conname;
  END LOOP;
END $$;

-- 2 · ONE constraint, the shipped plural, plus the two additions
ALTER TABLE identities ADD CONSTRAINT identities_supplies_chk CHECK (supplies IN (
  'goods',     -- sells things
  'services',  -- ⭐ PLURAL — what routes/entities.js has validated since long before today
  'both',      -- work and parts. Chola Auto Care, a garage, is on this and was set by hand.
  'none',      -- supplies nothing: a reference object, never a party to trade
  'unknown'    -- ⚠️ nobody has asked. A default, never an option on a screen.
));

ALTER TABLE identities ALTER COLUMN supplies SET DEFAULT 'unknown';

-- 3 · the two rows we know for certain, named by a structural fact and not by a guess about a name
UPDATE identities SET supplies = 'none'
 WHERE entity_kind = 'internal' AND sealed = true;

UPDATE identities SET supplies = 'services'
 WHERE user_id = 'cbincroot';

COMMIT;

-- ── WHAT YOU SHOULD SEE ────────────────────────────────────────────────────────────────────────────────────────
SELECT conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid = 'identities'::regclass AND contype = 'c'
   AND pg_get_constraintdef(oid) ILIKE '%supplies%';
-- ⭐ EXACTLY ONE ROW, and it must contain 'services' plural, 'none' and 'unknown'.

SELECT supplies, count(*) AS n FROM identities
 WHERE identity_type = 'entity' AND coalesce(status,'active') <> 'erased'
 GROUP BY 1 ORDER BY 2 DESC;
-- ⭐ EXPECTED: goods ~2497 · none 8 · services 1 (cbincroot) · both 1 (Chola Auto Care).
--    ⚠️ The 2,497 'goods' are NOT swept — see b238: that is the column's old default, and a row where somebody
--    pressed Save on a preselected 'goods' is a real answer we cannot tell from one nobody was ever asked.

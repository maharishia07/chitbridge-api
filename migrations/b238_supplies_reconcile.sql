-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b238 — RECONCILE `supplies`. b237 was written against a column that already existed.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- ⚠️⚠️ WHAT b237 ACTUALLY DID, WHICH IS NOT WHAT IT SAID IT WOULD DO.
--
-- It opened with `ALTER TABLE identities ADD COLUMN IF NOT EXISTS supplies …`. The column ALREADY EXISTED, so
-- postgres skipped the whole statement — including the DEFAULT 'unknown' it was carrying. Both seed UPDATEs
-- were then guarded by `WHERE supplies = 'unknown'`, matched nothing, and did nothing.
--
-- ⭐ THE ONLY THING b237 CHANGED WAS THE CHECK CONSTRAINT — and it added the WRONG SPELLING.
--
--     the CHECK it created      goods · service  · both · none · unknown    (singular)
--     routes/entities.js sends  goods · services · both                     (plural, SHIPPED)
--
-- ⚠️⚠️ THAT IS A LIVE 500. A shop choosing "services" passes the validator and is refused by the database. The
-- mistake was mine twice over: I did not grep the route before writing the migration, and I described a column
-- as new without checking whether it existed.
--
-- ⭐ AND THE FEATURE IS ALREADY IN USE. `Chola Auto Care` is set to 'both' — a garage, answered deliberately
-- through the existing profile screen. That is real data and it decides the argument: the SHIPPED plural wins,
-- because it is what the working screen sends.
--
-- ── ⚠️ WHAT THIS DOES *NOT* DO, AND WHY ────────────────────────────────────────────────────────────────────────
--
-- 2,505 rows read 'goods', which is the column's own long-standing DEFAULT. b237 argued a default must never
-- assert something nobody said — and that argument still holds for NEW rows.
--
-- ⚠️ BUT THE EXISTING ROWS ARE NOT SAFE TO SWEEP. If the profile screen ever showed "goods" preselected and
-- somebody pressed Save, that row is a real answer, and it is indistinguishable from one that was never asked.
-- Rewriting 2,505 rows to 'unknown' would destroy every genuine 'goods' among them to fix the ones nobody set.
--
-- ⭐ So: the DEFAULT changes for what comes next, the existing rows are left alone, and the two rows we know
-- for certain are corrected. Honest beats tidy.
--
-- Supabase → SQL Editor → SELECT ALL → Run. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1 · the vocabulary the shipped route actually sends, plus the two additions
ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_supplies_chk;
ALTER TABLE identities ADD  CONSTRAINT identities_supplies_chk CHECK (supplies IN (
  'goods',     -- sells things
  'services',  -- ⭐ PLURAL. What routes/entities.js has validated since before today.
  'both',      -- work and parts. Chola Auto Care, a garage, is on this.
  'none',      -- supplies nothing: a reference object, never a party
  'unknown'    -- nobody has asked. ⚠️ Never offered on a screen — it is a default, not a choice.
));

-- 2 · a new entity is not assumed to sell goods
ALTER TABLE identities ALTER COLUMN supplies SET DEFAULT 'unknown';

-- 3 · the two we know, named by a structural fact rather than by a guess about a name
UPDATE identities SET supplies = 'none'
 WHERE entity_kind = 'internal' AND sealed = true;          -- the ISO/ICC standards, Edge Gateway, GOV-01

UPDATE identities SET supplies = 'services'
 WHERE user_id = 'cbincroot';                               -- we supply the platform. Athi's own examples --
                                                            -- helpdesk, incident management, test lab.
COMMIT;

-- ── WHAT YOU SHOULD SEE ────────────────────────────────────────────────────────────────────────────────────────
SELECT supplies, count(*) AS n FROM identities
 WHERE identity_type = 'entity' AND coalesce(status,'active') <> 'erased'
 GROUP BY 1 ORDER BY 2 DESC;

-- ⭐ EXPECTED: goods ~2497 · none 8 · services 1 · both 1.
--    'unknown' is ZERO today and that is correct — it applies from the next registration onwards, not
--    retroactively to rows whose answer cannot be recovered.

SELECT pg_get_constraintdef(oid) AS now_allows
  FROM pg_constraint WHERE conname = 'identities_supplies_chk';
-- ⭐ must contain 'services', plural. If it says 'service', the 500 is still live.

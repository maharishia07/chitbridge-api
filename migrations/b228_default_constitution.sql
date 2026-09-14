-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b228 — is_default POINTS AT A RETIRED CONSTITUTION. Move it to the live one.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Found 2026-09-14 while chasing a governance bug that turned out not to exist. This one does.
--
--     constitution_key   version   active   is_default
--     base               v1        false    TRUE        ← retired by b179, still the declared default
--     base               v2        true     false       ← the live one
--     service-desk       v1        true     false
--
-- b179 minted base@v2 and retired v1. It moved `active` and never moved `is_default`, so the flag that names
-- the fallback constitution now points at a row that is switched off.
--
-- ── ⚠️ WHY NOTHING HAS BROKEN, AND WHY IT STILL MUST BE FIXED ──────────────────────────────────────────────────
--
-- Two lookups read this table, and both survive by accident:
--
--   lib/govresolve.js:110    ... WHERE active = true ORDER BY (is_default IS TRUE) DESC, minted_at DESC LIMIT 1
--       Filters on active FIRST, so it never sees v1. Among the active rows none is default, so the tie-break
--       falls to minted_at and base@v2 (2026-08-20) beats service-desk@v1 (2026-07-08). ⚠️ IT PICKS THE RIGHT
--       ROW BY DATE ORDER. Mint any vertical constitution after today and the platform default silently
--       becomes that vertical for every entity that does not name one.
--
--   routes/entities.js:274   ... WHERE is_default = true AND active = true LIMIT 1
--       This is the FALLBACK used when an entity's chosen constitution is not found. It matches NOTHING, so the
--       fallback is dead: `c` stays undefined, the `if (c)` guard skips, and the entity is minted with no
--       governance stamp at all — silently, because the whole block is wrapped in a try/catch that warns.
--       ⭐ It has not fired only because the primary lookup for 'base' always succeeds.
--
-- ⚠️ SO THIS IS A LATENT FAULT, NOT A LIVE ONE — and the kind that surfaces the first time somebody registers
--    against a vertical that does not exist, which is exactly what a white-label deployment will do.
--
-- Supabase → SQL Editor → paste → Run. Idempotent; safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ⚠️⚠️ RENUMBERED 2026-09-14. This was written as b160, and b160 WAS ALREADY TAKEN by
--    b160_definitions.sql. Eight files written today collided the same way: I saw b151 and
--    b154 in the folder and assumed the series ended there. It is at 222.
-- ⭐ NOT YET RUN.
--

-- ── 1 · LOOK FIRST ─────────────────────────────────────────────────────────────────────────────────────────────
SELECT constitution_key, version, active, is_default,
       CASE WHEN is_default AND NOT active THEN '⚠️ default but RETIRED'
            WHEN is_default AND active     THEN 'ok — the live default'
            ELSE '' END AS note
  FROM constitution ORDER BY constitution_key, version;

-- ── 2 · MOVE THE FLAG TO THE ACTIVE ROW ────────────────────────────────────────────────────────────────────────
-- ⚠️ Exactly one default, and it must be an ACTIVE row. Cleared everywhere first so a re-run cannot leave two.
BEGIN;

UPDATE constitution SET is_default = false WHERE is_default = true;

UPDATE constitution SET is_default = true
 WHERE constitution_key = 'base'
   AND active = true
   AND version = (SELECT version FROM constitution
                   WHERE constitution_key = 'base' AND active = true
                   ORDER BY minted_at DESC LIMIT 1);

COMMIT;

-- ── 3 · WHAT YOU SHOULD SEE ────────────────────────────────────────────────────────────────────────────────────
-- ⭐ base@v2 · active true · is_default true, and exactly one default in the table.
SELECT constitution_key, version, active, is_default FROM constitution ORDER BY 1, 2;
SELECT count(*) AS defaults_declared, count(*) FILTER (WHERE active) AS of_which_active
  FROM constitution WHERE is_default = true;

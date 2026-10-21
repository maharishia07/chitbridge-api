-- b176 — a business has a clock, and until now only its readers did.
--
-- Athi, 2026-08-20: *"how come it is mine? It is entity's timezone and currency, country, clock etc.. is it
-- not?"*
--
-- ⭐⭐ HE IS RIGHT, AND THE CODE COULD NOT SAY SO. `identities` carries country and currency_code — both facts
-- about the business — but no timezone. The only zone in the system was CBLocale's, which is the READER's
-- device. So the profile showed two entity facts and two personal preferences side by side, and the honest
-- label for the second pair was "Yours" — accurate about the code, wrong about the product.
--
-- ⭐ WHY IT MATTERS BEYOND A LABEL. A chit is a shared record. This platform already refuses to let one read
-- differently to each party — language is chosen between versions a human wrote, money is never converted. A
-- TIMESTAMP is the same kind of fact: "received 19:00" must mean one instant with one reading inside the
-- business, or two colleagues discussing the same chit are discussing different times.
--
-- ⚠️⚠️ THIS MIGRATION STORES THE FACT. IT DOES NOT YET REDIRECT RENDERING. Every date on every screen still
-- renders through CBLocale (the reader's zone), and switching that is a deliberate change across the whole
-- app — not a side effect of adding a column. The profile will state the business's zone honestly; the
-- rest follows when it is chosen. Recording the difference is the point: a column that quietly changed how
-- every timestamp reads would be the worst possible way to make this correct.
--
-- ⚠️ NULL MEANS NOT SET, NOT UTC. An entity with no zone yet must not be silently declared to run on UTC —
-- the screen says "not set" and the owner picks one. Defaulting would manufacture a fact nobody chose.
--
-- identities is WITHOUT ROW LEVEL SECURITY — the deliberate b54 cross-tenant carve-out.

ALTER TABLE identities ADD COLUMN IF NOT EXISTS timezone varchar(64);

COMMENT ON COLUMN identities.timezone IS
  'IANA zone the BUSINESS runs on (e.g. Asia/Kolkata). NULL = not set. Distinct from a reader''s device zone.';

/**
 * ⭐ A SENSIBLE FIRST GUESS FROM THE COUNTRY, FOR THE SINGLE-ZONE COUNTRIES ONLY.
 *
 * ⚠️ AND ONLY THOSE. India, the UAE and Singapore each have one civil zone, so the guess cannot be wrong. The
 * US, Australia, Russia and Canada span several — guessing there would put a specific, checkable, WRONG time
 * on a record. An owner picking from a list is better than a default that is right four times in five.
 */
UPDATE identities
   SET timezone = CASE country
         WHEN 'IN' THEN 'Asia/Kolkata'
         WHEN 'AE' THEN 'Asia/Dubai'
         WHEN 'SG' THEN 'Asia/Singapore'
         WHEN 'GB' THEN 'Europe/London'
         WHEN 'FR' THEN 'Europe/Paris'
         WHEN 'DE' THEN 'Europe/Berlin'
         WHEN 'SA' THEN 'Asia/Riyadh'
         ELSE NULL
       END
 WHERE identity_type = 'entity' AND timezone IS NULL AND country IS NOT NULL;

-- What was set, and what still needs an owner to choose. ONE result set — the editor shows only the last.
SELECT 'b176' AS report,
       COALESCE(country, '(none)') AS country,
       COALESCE(timezone, '(not set — owner must pick)') AS timezone,
       count(*) AS entities
  FROM identities
 WHERE identity_type = 'entity'
 GROUP BY country, timezone
 ORDER BY count(*) DESC;

-- b179 · APPLY — lift the four-currency cap by MINTING base@v2. Run the dry run first.
--
-- ⚠️⚠️ MY FIRST VERSION OF THIS FILE WAS WRONG ABOUT THE MODEL, and Postgres said so:
--     ERROR: 42883: operator does not exist: text + integer   ...   version = version + 1
-- `version` is TEXT ('v1'), and it is half of the PRIMARY KEY (constitution_key, version). A constitution is
-- not a row you edit — it is a row you SUPERSEDE. That is the whole point of the governance model: an entity
-- stamped under base@v1 must still be able to show what base@v1 said. UPDATEing the governance in place would
-- have rewritten history and left every stamp pointing at text that no longer exists.
--
-- ⚠️ IF YOU SAW "0 rows" NEXT TO THAT ERROR, that was this file, not the dry run. The UPDATE failed inside
-- BEGIN, which aborted the transaction, so the verification SELECT below it never ran and the pane had nothing
-- to show. The dry run is read-only and safe to run again on its own.
--
-- ⚠️⚠️ WHAT MINTING v2 DOES IMMEDIATELY, AND YOU SHOULD KNOW IT BEFORE RUNNING. lib/govresolve.js reads
-- `WHERE constitution_key = $1 AND active = true` — it does NOT pin to the version stamped on the entity. So
-- base@v2 takes effect for EVERY entity on base the moment it goes active; the stamp records what they adopted
-- but does not hold them there. That is the existing "version upgrade" gap, not something this migration
-- introduces — and here it is what we want, since v2 only REMOVES a restriction. It would matter a great deal
-- for a version that added one.
--
-- Reversible: set v2 inactive and v1 active again. v1's text is never touched.

BEGIN;

-- ⚠⚠ THE ORDER MATTERS, AND MY FIRST DRAFT HAD A RE-RUN FOOTGUN. It retired v1 and THEN inserted v2 with
--    ON CONFLICT DO NOTHING. Run it twice — or once after a partial attempt — and the insert does nothing
--    while the retire still fires, leaving base with NO active row at all. govresolve would then find no
--    constitution, fall back to allowed={} and lose the DEFAULTS too. Insert inactive first, then swap.

-- 1 · mint the successor, INACTIVE. Safe to re-run: constitution_active_idx only constrains active rows.
INSERT INTO constitution (constitution_key, version, label, vertical, governance, capabilities, active)
SELECT
  c.constitution_key,
  'v2',
  'Base constitution — any currency',
  c.vertical,
  --  ⚠️ jsonb_exists(x,'k') rather than x ? 'k' — several Postgres clients read a bare ? as a bind
  --     placeholder, and this file has to run in the SQL editor.
  CASE WHEN jsonb_exists(c.governance -> 'allowed', 'currencies')
       THEN jsonb_set(c.governance, '{allowed}', (c.governance -> 'allowed') - 'currencies')
       ELSE c.governance END,
  c.capabilities,
  false
FROM constitution c
WHERE c.constitution_key = 'base'
  --  ⚠️ SOURCED FROM WHATEVER IS ACTIVE, not from the name 'v1'. If base has already moved on, hardcoding
  --     v1 would copy a superseded row — or copy nothing and silently no-op while steps 2 and 3 still ran.
  AND c.active = true
ON CONFLICT (constitution_key, version) DO NOTHING;

-- 2 · retire v1 …
UPDATE constitution SET active = false
 WHERE constitution_key = 'base' AND active = true AND version <> 'v2';

-- 3 · … and raise v2 in its place. Separate statements, in this order, because constitution_active_idx is
--     UNIQUE on (constitution_key) WHERE active — two active base rows cannot exist even for a moment.
UPDATE constitution SET active = true
 WHERE constitution_key = 'base' AND version = 'v2';

-- 4 · ONE result set: every constitution, so the change and the things it did NOT touch are both visible.
SELECT
  constitution_key,
  version,
  active,
  CASE WHEN jsonb_exists(governance -> 'allowed', 'currencies')
       THEN 'capped: ' || (governance -> 'allowed' ->> 'currencies')
       ELSE 'any currency' END                                     AS currencies,
  CASE WHEN jsonb_exists(governance -> 'allowed', 'regions')
       THEN jsonb_array_length(governance -> 'allowed' -> 'regions')::text
       ELSE 'any' END                                              AS regions,
  CASE WHEN jsonb_exists(governance -> 'allowed', 'timezones')
       THEN jsonb_array_length(governance -> 'allowed' -> 'timezones')::text
       ELSE 'any' END                                              AS timezones,
  governance -> 'defaults' ->> 'currency'                          AS default_currency
FROM constitution
ORDER BY (constitution_key <> 'base'), constitution_key, version;

COMMIT;

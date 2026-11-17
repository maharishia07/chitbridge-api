-- b883_accounting_firm_vertical.sql — FIRMVERT (18 Nov 2026): "this entity is an accounting firm" is a TRADE answer, chosen at sign-up, not a new flag column.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first through the box's migrate step. Safe to repeat (ON CONFLICT / WHERE guards).
--    The api is correct BEFORE and AFTER this file runs: before it, no registrant can choose the firm setup and practice answers firm:false for everyone; after it, a firm that chose it answers firm:true.
-- NUMBER. b882 is the highest in the tree (agency edge audit); this is the next → b883. Rename before landing if another round took it.
-- WHY (leader practice, Athi's standing rule): Xero (partner / practice) and QuickBooks (QuickBooks Online Accountant) give an accounting practice its OWN account type, chosen at sign-up, distinct from a business file.
--    Here that is a vertical = a minted constitution row (b73: "adding a domain is THIS one row"). Nothing else stores it; lib/govresolve.verticalOf reads it; govresolve.isFirm is the one place the word is tested.
-- LOOKED AT (DISCIPLINES 4a): constitution (one row added, key accounting-firm@v1, vertical accounting-firm; the chooser GET /api/entities/constitutions lists every active row, so it appears with no code);
--    entity_governance (existing demo firms stamped); identities (read only, to find the demo firms by name).
-- WHAT IT DOES.
--    1. Seeds constitution accounting-firm@v1: same sealed rules, open fields, jurisdiction and capabilities as base v2; NO allowed/defaults block (they inherit from base, so no country or currency is chosen for the firm here).
--       governance.primitives says which neutral primitives are on by default: books_practice on · till off · catalogue off · consumes off. Configuration only: a box reads it as a slot and never tests the vertical.
--       (Nothing reads `primitives` yet: the Home and the till still show by the shop's own choices. This is the seeded default the boxes will read; it changes no behaviour today.)
--    2. Stamps the existing DEMO firms onto it: identities named 'Seed E Practice - demo' only (the Seed E firm, sit-grund). Never matches sit-au's demo stack: it is not named here, and a name that does not exist stamps nothing.
-- OWNER: lib/govresolve.js (verticalOf · isFirm) · lib/books-practice.js (the practice answer's `firm`) · tools/seed/seed-e.cjs (fresh demo firms choose it at verify).
-- ROLL BACK:
--    UPDATE entity_governance SET constitution_key = 'base', constitution_version = 'v2' WHERE constitution_key = 'accounting-firm';
--    DELETE FROM constitution WHERE constitution_key = 'accounting-firm';
-- CHECK (read-only, every row must read ok = true):
--    SELECT 'the firm constitution is active, one row' AS what, (SELECT count(*) FROM constitution WHERE constitution_key = 'accounting-firm' AND active) = 1 AS ok
--    UNION ALL SELECT 'its vertical is the key', (SELECT vertical FROM constitution WHERE constitution_key = 'accounting-firm' AND active) = 'accounting-firm'
--    UNION ALL SELECT 'no demo firm is left on another constitution', NOT EXISTS (SELECT 1 FROM identities i JOIN entity_governance g ON g.entity_id = i.identity_id WHERE i.display_name = 'Seed E Practice - demo' AND g.constitution_key <> 'accounting-firm');
-- RLS: no table is new, no policy changes. constitution is the shared catalogue (no entity column, cb_app SELECT as before). entity_governance keeps ENABLE + FORCE row security; this file runs AS postgres, which stands outside it, and writes only the demo firms' own rows.

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO constitution (constitution_key, version, label, vertical, is_default, governance, capabilities, active) VALUES
  ('accounting-firm', 'v1', 'Accounting firm', 'accounting-firm', false,
   '{"open": {"region": null, "currency_code": "INR"},
     "sealed": {"isolation": "per-copy", "no_orphans": true, "tighten_only": true},
     "jurisdiction": {"mode": "supplier", "custodian": false, "disclaimer": "The platform is the provider, not the custodian of the transaction; disputes are handled within the supplier''s jurisdiction."},
     "primitives": {"books_practice": true, "till": false, "catalogue": false, "consumes": false}}'::jsonb,
   '["core", "connector", "dispute", "workforce"]'::jsonb, true)
ON CONFLICT (constitution_key, version) DO UPDATE SET
  label = EXCLUDED.label, vertical = EXCLUDED.vertical, is_default = false,
  governance = EXCLUDED.governance, capabilities = EXCLUDED.capabilities, active = true;

-- the existing demo firms: a stamp row each (insert when a firm has none), moved onto the firm constitution
INSERT INTO entity_governance (entity_id, constitution_key, constitution_version)
SELECT i.identity_id, 'accounting-firm', 'v1' FROM identities i WHERE i.display_name = 'Seed E Practice - demo'
ON CONFLICT (entity_id) DO UPDATE SET constitution_key = 'accounting-firm', constitution_version = 'v1', minted_at = now();
COMMIT;

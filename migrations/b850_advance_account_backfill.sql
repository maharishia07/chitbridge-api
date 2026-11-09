-- b850_advance_account_backfill.sql — ACC-336 slice 1b (9 Nov 2026): the tax-paid-in-advance ledgers in the chart of every India shop already seeded.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres: RLS does not apply to the owner, so one run sees every shop) after SIT has run it. Safe to repeat: ON CONFLICT DO NOTHING
--    on the two unique indexes (entity_id, code) and (entity_id, role); a second run inserts 0 rows. Independent of b849. Adds rows only; nothing is updated or deleted.
--
-- WHY. A cash payment above the period's net tax is held in its own asset ledger per head, never as input credit (design ACC-336 rev 4 section 3.5). A shop's chart was seeded before
--    that role existed and cb_app cannot delete or reseed the chart (b272), so the existing charts get the four rows here (critic build condition 1). Until a shop has the row, the
--    api (slice 2) treats it exactly as a pack without the key: excess shown, paid_note, no entry, close 200.
-- NEW SHOPS. A new shop's chart is laid by lib/books.js enable() from the country pack (E.chartRows), not by SQL, so the new-shop seed is the pack row (engines slice 0,
--    taxLedgers[head].advance + the asset role), which MUST carry exactly the codes and roles below. Nothing in SQL seeds a future shop.
-- THE ROWS (India; the names are working text, the official-term label is cb-country's text key and is NOT typed in code):
--    role tax_advance_cgst code 1830 · tax_advance_sgst 1831 · tax_advance_igst 1832 · tax_advance_cess 1833; nature asset; parent G1800 (Current Assets, range 1800-1899).
--    Group and codes are a cb-country call: if slice 0 picks others, this file is replaced BEFORE Athi runs it (a run file is never edited after).
--    1830-1833 are free in India's template (reg-in.js: 1810 and 1820 are the only ledger codes in the group).
--    tally_group / sch3_line / saft_grouping / pack_version are COPIED from the same shop's prepaid_expenses row (same group), never typed here.
-- WHICH SHOPS. Only India: pack_code IN and the shop has its G1800 group row. Australia and the UAE get NO row: their wording is TO CONFIRM against the ATO and EmaraTax
--    primary pages (design section 10) and the role is not in their packs yet; theirs is a later file once a person has read those pages.
-- A SHOP THAT USES 1830-1833 ITSELF keeps its ledger (DO NOTHING); that shop gets no advance ledger and the api falls back to paid_note.
-- FRESH DB: no shop exists, 0 rows is expected and gives a NOTICE.
-- ROLL BACK (only rows no entry or balance uses; the FKs refuse the rest, so it can never orphan a posting):
--    DELETE FROM ledger_account a WHERE a.role IN ('tax_advance_cgst','tax_advance_sgst','tax_advance_igst','tax_advance_cess')
--      AND NOT EXISTS (SELECT 1 FROM journal_line l WHERE l.account_id = a.account_id) AND NOT EXISTS (SELECT 1 FROM account_balance b WHERE b.account_id = a.account_id);
-- CHECK (read-only, one row; READ-2026-11-09-2-acc336-s1-check.sql gives all of it as one cell):
--    SELECT count(*) AS shops_missing_advance FROM ledger_account g WHERE g.code = 'G1800' AND upper(g.pack_code) = 'IN'
--      AND (SELECT count(*) FROM ledger_account x WHERE x.entity_id = g.entity_id AND x.role LIKE 'tax\_advance\_%') < 4;   Expect 0 after the run (except a shop that uses 1830-1833 itself, see above).
-- RLS: unchanged. ledger_account stays ENABLED + FORCED with its entity policy; each row carries its own shop's entity_id.

DO $$
DECLARE shops integer;
BEGIN
  SELECT count(*) INTO shops FROM ledger_account g WHERE g.code = 'G1800' AND upper(g.pack_code) = 'IN';
  IF shops = 0 THEN
    RAISE NOTICE 'b850: no India shop chart here (fresh database): 0 rows inserted, expected.';
  END IF;
END $$;

INSERT INTO ledger_account (entity_id, code, name, parent_id, is_group, nature, role, pack_code, pack_version, tally_group, sch3_line, saft_grouping, active)
SELECT g.entity_id, v.code, v.name, g.account_id, false, 'asset', v.role, g.pack_code, ref.pack_version, ref.tally_group, ref.sch3_line, ref.saft_grouping, true
FROM ledger_account g
CROSS JOIN (VALUES
  ('1830', 'tax_advance_cgst', 'CGST paid in advance'),
  ('1831', 'tax_advance_sgst', 'SGST paid in advance'),
  ('1832', 'tax_advance_igst', 'IGST paid in advance'),
  ('1833', 'tax_advance_cess', 'Cess paid in advance')
) AS v(code, role, name)
LEFT JOIN LATERAL (
  SELECT p.pack_version, p.tally_group, p.sch3_line, p.saft_grouping FROM ledger_account p
  WHERE p.entity_id = g.entity_id AND p.role = 'prepaid_expenses' ORDER BY p.code LIMIT 1) ref ON true
WHERE g.code = 'G1800' AND upper(g.pack_code) = 'IN' AND g.is_group
ON CONFLICT DO NOTHING;

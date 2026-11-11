-- READ-2026-11-09-2-acc336-s1-check.sql — ACC-336 slice 1: read-only, ONE jsonb cell (the Supabase editor shows only the last statement's result).
-- Run after b849 and b850. Expect: carrier_column 1, both rls {enabled:true, forced:true}, india_shops_missing_advance 0 (a partial shop counts here; partial_shops lists their entity_ids), advance_rows = 4 x india_shops.
SELECT jsonb_build_object(
  'carrier_column', (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'journal_entry' AND column_name = 'tax_period'),
  'journal_entry_rls', (SELECT jsonb_build_object('enabled', relrowsecurity, 'forced', relforcerowsecurity) FROM pg_class WHERE oid = 'public.journal_entry'::regclass),
  'ledger_account_rls', (SELECT jsonb_build_object('enabled', relrowsecurity, 'forced', relforcerowsecurity) FROM pg_class WHERE oid = 'public.ledger_account'::regclass),
  'india_shops', (SELECT count(*) FROM ledger_account WHERE code = 'G1800' AND upper(pack_code) = 'IN'),
  'india_shops_missing_advance', (SELECT count(*) FROM ledger_account g WHERE g.code = 'G1800' AND upper(g.pack_code) = 'IN'
      AND (SELECT count(*) FROM ledger_account x WHERE x.entity_id = g.entity_id AND x.role LIKE 'tax\_advance\_%') < 4),
  'partial_shops', (SELECT coalesce(jsonb_agg(g.entity_id ORDER BY g.entity_id), '[]'::jsonb) FROM ledger_account g WHERE g.code = 'G1800' AND upper(g.pack_code) = 'IN'
      AND (SELECT count(*) FROM ledger_account x WHERE x.entity_id = g.entity_id AND x.role LIKE 'tax\_advance\_%') < 4),
  'advance_rows', (SELECT count(*) FROM ledger_account WHERE role LIKE 'tax\_advance\_%')
) AS acc336_slice1;

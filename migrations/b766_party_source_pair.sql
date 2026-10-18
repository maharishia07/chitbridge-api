-- b766_party_source_pair.sql — move-in W1.8 (2026-10-18): A MOVED-IN PARTY KEEPS THEIR CONTACT ID. Two nullable columns on each list, one partial unique index each.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Written offline, read, never executed. Safe to re-run (ADD COLUMN IF NOT EXISTS,
--    CREATE UNIQUE INDEX IF NOT EXISTS). No data is touched: every existing row keeps NULL.
--    Until it runs: lib/move-in asks lib/schema hasColumn first — their contact id is kept in the import's proof only, bills match by name (as today), and
--    the import's reply says so in words. Never a 500.
--
-- RLS: unchanged — customer_list / supplier_list keep their owner policies (owner_entity_id = app.current_entity); no policy is added, dropped or relaxed.
--
-- WHY (MOVE-IN-GAPS-REQUIREMENT W1.8, critic C11): Xero ContactID · QBO Customer/Vendor Id · Zoho contact_id identify the party in THEIR books; a contact
--    renamed there must still find its bills here. ONE shape: the same source_system + source_ref pair a moved-in product already carries in item_data
--    (lib/move-in items: source_system, source_ref) — no new key name.
--
-- WHAT (chitbridge-api docs/FIELDS.md "customer_list.source_system / source_ref"):
--   source_system  text   xero · qbo — whose id it is, ≤ 20
--   source_ref     text   their contact id, ≤ 80; one party per (shop, system, id) — a second claim is refused by the index and the move-in keeps it off (logged)
ALTER TABLE customer_list ADD COLUMN IF NOT EXISTS source_system text CHECK (source_system IS NULL OR char_length(source_system) BETWEEN 1 AND 20);
ALTER TABLE customer_list ADD COLUMN IF NOT EXISTS source_ref    text CHECK (source_ref IS NULL OR char_length(source_ref) BETWEEN 1 AND 80);
ALTER TABLE supplier_list ADD COLUMN IF NOT EXISTS source_system text CHECK (source_system IS NULL OR char_length(source_system) BETWEEN 1 AND 20);
ALTER TABLE supplier_list ADD COLUMN IF NOT EXISTS source_ref    text CHECK (source_ref IS NULL OR char_length(source_ref) BETWEEN 1 AND 80);

CREATE UNIQUE INDEX IF NOT EXISTS customer_list_source_uq ON customer_list (owner_entity_id, source_system, source_ref) WHERE source_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_list_source_uq ON supplier_list (owner_entity_id, source_system, source_ref) WHERE source_ref IS NOT NULL;

COMMENT ON COLUMN customer_list.source_ref IS 'move-in W1.8: their contact id (Xero ContactID · QBO Customer Id), with source_system; NULL when not moved in';
COMMENT ON COLUMN supplier_list.source_ref IS 'move-in W1.8: their contact id (Xero ContactID · QBO Vendor Id), with source_system; NULL when not moved in';

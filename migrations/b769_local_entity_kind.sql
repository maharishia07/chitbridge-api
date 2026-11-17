-- b769_local_entity_kind.sql — K-DB / OPS-41 (21 Oct 2026): 'local' joins the closed entity_kind vocabulary.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (DROP CONSTRAINT IF EXISTS, then ADD, in one
--    transaction). Touches no rows: it re-checks every existing row against a list that only grew.
--
-- WHY. lib/local-identity.js mints a party a shop typed by name (a customer by name through api #13, a supplier, a CSV lead) with a
--    '~owner.cus-0001' / '~owner.sup-0001' handle and wrote entity_kind 'supplier' for ALL of them, so a customer by name counted as a
--    supplier (OPS-41). 'local' = a party a shop minted that never registered, whichever side it trades on (the handle's kind says which).
--    Until this runs, the code checks the constraint and keeps writing 'supplier' with a log line, so nothing breaks before it.
-- NOT HERE. Moving the existing '~' rows from 'supplier' to 'local' is a data change: the count is READ-2026-10-21-4-local-kind-count.sql
--    and the move is Athi's call (MANIFEST.md, Needs Athi).
-- RLS: unchanged (identities keeps its policies; a CHECK is not a policy). Previous list: baseline 000_baseline_2026-10-21.sql:3858.

BEGIN;
ALTER TABLE identities DROP CONSTRAINT IF EXISTS identities_entity_kind_chk;
ALTER TABLE identities ADD CONSTRAINT identities_entity_kind_chk CHECK (entity_kind IN ('customer', 'network', 'supplier', 'test', 'internal', 'actor', 'shopper', 'local'));
COMMIT;

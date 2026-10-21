-- b775_minted_parties_to_local.sql — K-DB / OPS-41 (21 Oct 2026): parties a shop minted by name move from entity_kind 'supplier' to 'local'.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres) AFTER b769 (it needs 'local' in identities_entity_kind_chk;
--    run alone before b769 it stops with a check error and changes nothing). Safe to re-run: it only touches rows still not 'local', so a
--    second run finds 0 and says so. One transaction; the expected count is 1.
--
-- WHY. A '~owner.cus-0001' / '~owner.sup-0001' party is one a shop typed by name that never registered. Every mint wrote 'supplier',
--    so a customer by name counted as a supplier (OPS-41). Since b769 the code mints 'local' (lib/local-identity.js mintKind); this moves
--    the ones written before. READ-2026-10-21-4 (21 Oct): exactly 1 minted party, entity_kind supplier, side sup, test population.
--    The predicate is that READ's: identity_type = 'entity' AND user_id LIKE '~%'. Only entity_kind changes; no handle, name or link.
-- GUARD. 0 rows is fine (a fresh database has none: NOTICE). More than 5 means the data is not what READ-4 saw: it stops and changes
--    nothing, so a wrong predicate cannot rewrite a shop's party list.
-- RLS: unchanged. Run as postgres (the owner), which bypasses RLS, so it reaches every shop's rows.

BEGIN;
DO $$
DECLARE moved integer;
BEGIN
  UPDATE identities SET entity_kind = 'local'
   WHERE identity_type = 'entity' AND user_id LIKE '~%' AND entity_kind IS DISTINCT FROM 'local';
  GET DIAGNOSTICS moved = ROW_COUNT;
  IF moved > 5 THEN
    RAISE EXCEPTION 'b775 stopped: % minted parties would move, READ-2026-10-21-4 counted 1. Nothing changed.', moved;
  ELSIF moved = 0 THEN
    RAISE NOTICE 'b775: no minted party left to move (already local, or a fresh database).';
  ELSE
    RAISE NOTICE 'b775: % minted party(ies) moved to entity_kind local.', moved;
  END IF;
END $$;
COMMIT;

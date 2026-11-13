-- b848_net_reroot_door.sql — NET-93 (9 Nov 2026): the ONE consented door through b843's root-immutable trigger.
--
-- ⚠️ NOT RUN anywhere · Athi runs it (SQL editor, AS postgres) AFTER b843, on sit-in and sit-au first, then production. Safe to repeat (CREATE OR REPLACE of one
--    function; the trigger b843 made keeps pointing at it). Touches no rows, no table, no grant.
--
-- WHY. b843's trigger refused every change of a path's first label, but approving a tree edge (a business joins a network) and disconnecting it move a whole
--    subtree to another root, so both answered 500 on a database with b843. b843 already ran on sit-in and sit-au, so it is NOT edited (tools/migrate.cjs
--    keeps a sha256 per applied file and would call it changed, never re-run it): this file replaces the function instead.
-- THE DOOR. The rule lets a root change through only when the transaction named a root in the setting cb.net_reroot AND that label is the row's old root or its
--    new root. src/services/network.js reRootGuard sets it with set_config(..., true) (local to the transaction, so it is gone at COMMIT/ROLLBACK and never
--    reaches a pooled connection's next request) only after the edge's own rule passed. A bare UPDATE, or naming a third root, is still refused (23514).
-- ROLL BACK: re-run the CREATE OR REPLACE FUNCTION of b843_cb_entity_root_path.sql (the strict body); network approve/disconnect of a tree edge then answer 500 again.
-- CHECK (read-only): SELECT prosrc LIKE '%cb.net_reroot%' FROM pg_proc WHERE proname = 'cb_entity_root_is_immutable';   Expect t.
-- RLS: cb_entity is not tenant-scoped (see b843); unchanged here.

CREATE OR REPLACE FUNCTION cb_entity_root_is_immutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  old_root ltree := subpath(OLD.path, 0, 1);
  new_root ltree := subpath(NEW.path, 0, 1);
  consented text := nullif(current_setting('cb.net_reroot', true), '');
BEGIN
  IF new_root IS DISTINCT FROM old_root AND consented IS DISTINCT FROM old_root::text AND consented IS DISTINCT FROM new_root::text THEN
    RAISE EXCEPTION 'an entity cannot change networks: % → % (entity %)', old_root, new_root, OLD.bridge_id
      USING HINT = 'Moving WITHIN a network is allowed. Joining or leaving one goes through the approved connection (NET-93), never a bare path update.', ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$fn$;

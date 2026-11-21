-- b890_cb_entity_root_immutable_consent_door.sql — puts NET-93's consented door (b848) back into the root-immutable trigger function, keeping b889's pinned search_path (20 Nov 2026).
--
-- ⚠️ NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres), SIT first, AFTER b889. Safe to repeat (CREATE OR REPLACE of one function; the trigger b843/b889 made keeps pointing at it). Touches no rows, no table, no column, no grant.
-- WHY. b889 sorts after b848 and re-created cb_entity_root_is_immutable() with b843's strict body, so a database that ran b889 refuses EVERY change of a path's first label, including the approved connection
--    (a business joins a network tree, or leaves it). The api sets the transaction-local setting cb.net_reroot (src/services/network.js reRootGuard) only after the edge's own rule passed; the strict body ignores it
--    and the approve / disconnect answer 500 (CI S41 NET-93 failed 8 of 15). b889 itself is NOT edited: it already ran on production and the SIT boxes (the migration fingerprint keeps its bytes).
-- WHAT. The function body is b848's (the consented door: a root may change only when cb.net_reroot names the row's old or new root; a bare UPDATE or a third root is still refused, 23514) plus SET search_path = public, pg_catalog
--    from b889 (so a restore keeps working). The trigger and its text WHEN clause (b889) are untouched.
-- ROLL BACK: re-run migrations/b889_cb_entity_root_immutable_restore_safe.sql (the strict body again; approve / disconnect of a tree edge answer 500 again).
-- CHECK (read-only): SELECT prosrc LIKE '%cb.net_reroot%' AND proconfig::text LIKE '%search_path%' AS ok FROM pg_proc WHERE proname = 'cb_entity_root_is_immutable';   (true)
-- RLS: cb_entity is not tenant-scoped (see b843); unchanged here.

BEGIN;
SET LOCAL lock_timeout = '5s';   -- a busy table fails the run fast (nothing changes; run it again)

CREATE OR REPLACE FUNCTION cb_entity_root_is_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_catalog AS $fn$
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
COMMIT;

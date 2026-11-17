-- b884_dispute_handler_to_routing.sql — D3 (18 Nov 2026): the shop's dispute handler becomes ONE entity_work_routing row, kind 'dispute', assignee only.
--
-- NOT RUN anywhere · Athi runs it (Supabase SQL editor, AS postgres) after a SIT box has run it. Safe to repeat: ON CONFLICT (entity_id, kind) DO NOTHING, so a second run inserts 0 rows
--    and a shop that already has a dispute row (set from the new screen) keeps it. Adds rows only; nothing is updated or deleted; the column identities.dispute_handler_actor_id STAYS
--    (dropping it is an Athi HOLD, after one release with zero reads of it; see docs/critique note D3 in PM/critic/D3-DISPUTES-ASSIGN-CRITIC-2026-11-18.md).
-- WHY. A dispute is never given to a person today; the bell reads identities.dispute_handler_actor_id. D3 folds it into the routing rung every other kind already uses
--    (lib/workroute routeFor), so there is one place that says where work goes. Code ships first and falls back to the column until this has run.
-- RLS: entity_work_routing is ENABLED + FORCED (policy rls_entity on app.current_entity). The loop binds app.current_entity to each shop for its own insert (transaction-local), so the
--    file works for a role that is subject to the policy as well as for postgres, and a row can only ever be written for the shop it names. The policy is unchanged.
-- FRESH DB: no identities, 0 rows, a NOTICE.
-- ROLL BACK: DELETE FROM entity_work_routing r WHERE r.kind = 'dispute' AND r.folder_id IS NULL AND r.route_to_entity_id IS NULL AND r.notify_email IS NULL
--              AND r.assignee_actor_id = (SELECT i.dispute_handler_actor_id FROM identities i WHERE i.identity_id = r.entity_id);   (rows still equal to the column)
-- CHECK (read-only, expect 0 after the run): SELECT count(*) FROM identities i WHERE i.dispute_handler_actor_id IS NOT NULL
--              AND NOT EXISTS (SELECT 1 FROM entity_work_routing r WHERE r.entity_id = i.identity_id AND r.kind = 'dispute');   (run AS postgres, or bind app.current_entity per shop)

DO $$
DECLARE s record; n integer := 0; c integer;
BEGIN
  FOR s IN SELECT identity_id, dispute_handler_actor_id FROM identities WHERE dispute_handler_actor_id IS NOT NULL LOOP
    PERFORM set_config('app.current_entity', s.identity_id::text, true);
    INSERT INTO entity_work_routing (entity_id, kind, assignee_actor_id, updated_at)
    VALUES (s.identity_id, 'dispute', s.dispute_handler_actor_id, now())
    ON CONFLICT (entity_id, kind) DO NOTHING;
    GET DIAGNOSTICS c = ROW_COUNT;
    n := n + c;
  END LOOP;
  PERFORM set_config('app.current_entity', '', true);
  IF n = 0 THEN
    RAISE NOTICE 'b884: no dispute handler to move (fresh database or already moved): 0 rows inserted.';
  ELSE
    RAISE NOTICE 'b884: % dispute handler(s) moved to entity_work_routing kind dispute.', n;
  END IF;
END $$;

-- b782_party_merge_guard.sql — CRM-43 (29 Oct 2026): the database refuses a merge that makes a chain or a loop on the party lists. A BACKSTOP to lib/party-fields.checkMergeTarget.
--
-- ⚠️⚠️ RUN by Athi 2026-10-29 (Supabase SQL editor, AS postgres). Was a recommendation only: the api already refuses these cases (and serialises one shop's merges with an advisory
--    lock), so nothing waits on this. Safe to re-run (CREATE OR REPLACE FUNCTION; the triggers are dropped and re-created). Touches no rows; existing data is not re-checked.
--
-- WHY. The api check and the UPDATE are two statements; a second writer path (a script, the SQL editor, a future route) would skip the check and leave A->B and B->A, and both parties vanish from the list.
-- WHAT. BEFORE INSERT OR UPDATE OF merged_into on customer_list and supplier_list: when merged_into is set, refuse it if (a) the row points at itself, (b) the target party is itself merged into
--    another on either list of the same shop, or (c) other rows of the same shop already point at this row's party. The party id of a customer row is customer_identity_id, of a supplier row supplier_entity_id.
-- COVERS: self, chain and loop only. That the target is a party on THIS shop's lists (404) stays in the app (checkMergeTarget). The function takes the app's per-shop advisory lock first.
-- RLS: unchanged. The function is SECURITY INVOKER, so it sees only the calling shop's rows (rls_entity), which is exactly the scope of the check. No grants needed.

CREATE OR REPLACE FUNCTION party_merge_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  me uuid;
BEGIN
  IF NEW.merged_into IS NULL THEN RETURN NEW; END IF;
  /* the same per-shop lock the app takes (lib/party-fields.js checkMergeTarget: 'merge:' + owner, owner = lower-case uuid text): two sessions under READ COMMITTED can no longer both pass the reads and leave A->B, B->A */
  PERFORM pg_advisory_xact_lock(hashtext('merge:' || NEW.owner_entity_id::text));
  /* an IF, never a CASE: plpgsql resolves NEW.<column> while evaluating the expression, so a CASE that names a column the other table lacks
     fails with 'record "new" has no field ...' on every merge (found by CI's fresh-db build of PR 505, 29 Oct) */
  IF TG_TABLE_NAME = 'customer_list' THEN me := NEW.customer_identity_id; ELSE me := NEW.supplier_entity_id; END IF;
  IF NEW.merged_into = me THEN RAISE EXCEPTION 'A party cannot be merged into itself.' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM customer_list c WHERE c.owner_entity_id = NEW.owner_entity_id AND c.customer_identity_id = NEW.merged_into AND c.merged_into IS NOT NULL)
     OR EXISTS (SELECT 1 FROM supplier_list s WHERE s.owner_entity_id = NEW.owner_entity_id AND s.supplier_entity_id = NEW.merged_into AND s.merged_into IS NOT NULL) THEN
    RAISE EXCEPTION 'That party is already merged into another.' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM customer_list c WHERE c.owner_entity_id = NEW.owner_entity_id AND c.merged_into = me)
     OR EXISTS (SELECT 1 FROM supplier_list s WHERE s.owner_entity_id = NEW.owner_entity_id AND s.merged_into = me) THEN
    RAISE EXCEPTION 'Other parties are merged into this one, so it cannot be merged away.' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS customer_list_merge_guard ON customer_list;
CREATE TRIGGER customer_list_merge_guard BEFORE INSERT OR UPDATE OF merged_into ON customer_list FOR EACH ROW EXECUTE FUNCTION party_merge_guard();
DROP TRIGGER IF EXISTS supplier_list_merge_guard ON supplier_list;
CREATE TRIGGER supplier_list_merge_guard BEFORE INSERT OR UPDATE OF merged_into ON supplier_list FOR EACH ROW EXECUTE FUNCTION party_merge_guard();

-- Undo: DROP TRIGGER customer_list_merge_guard ON customer_list; DROP TRIGGER supplier_list_merge_guard ON supplier_list; DROP FUNCTION party_merge_guard();

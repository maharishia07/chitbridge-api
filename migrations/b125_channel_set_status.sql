-- b125: the platform must be able to GRANT verified — which, under FORCE RLS, it could not.
--
-- b124 added POST /api/channels/:id/approve behind CB_ADMIN_KEY, and it returned 404 "Binding not found" for a
-- binding that plainly existed. The key was fine; the UPDATE matched zero rows.
--
-- ⚠️ FORCE ROW LEVEL SECURITY APPLIES TO THE TABLE OWNER TOO. cb_app gets no implicit bypass, so a statement run
-- WITHOUT `app.current_entity` set sees NOTHING — not everything. I reasoned about this correctly for the read
-- (channel_owner is SECURITY DEFINER precisely because a webhook has no session) and then wrote the admin write as
-- a plain context-free UPDATE, as if absent context meant unrestricted. It means the opposite.
--
-- withEntity() cannot help here either: the platform operator is not an entity, and scoping the update to some
-- entity's context would only ever reach that entity's own rows — which is the gap, not the fix.
--
-- So the grant goes on the same narrow SECURITY DEFINER rail as the lookup: one function, one job, no listing.
CREATE OR REPLACE FUNCTION channel_set_status(p_id uuid, p_status text, p_via text)
RETURNS TABLE (id uuid, entity_id uuid, channel text, address text, status text,
               verified_at timestamptz, verified_via text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE channel_binding
     SET status       = p_status,
         -- ⚠️ Revoking must CLEAR the evidence, not leave a verified_at behind on a declared row. A binding that
         -- still carries "verified 3 March" while reading `declared` is a record that disagrees with itself.
         verified_at  = CASE WHEN p_status = 'verified' THEN now()  ELSE NULL END,
         verified_via = CASE WHEN p_status = 'verified' THEN p_via  ELSE NULL END,
         updated_at   = now()
   WHERE channel_binding.id = p_id
     -- ⚠️ Only these two. The rung is a closed set; an arbitrary string arriving here would invent a status that
     -- channel_owner() does not recognise, and the binding would silently stop resolving for reasons nobody
     -- could see. An unknown status updates nothing and the route answers 404.
     AND p_status IN ('verified', 'declared')
  RETURNING channel_binding.id, channel_binding.entity_id, channel_binding.channel, channel_binding.address,
            channel_binding.status, channel_binding.verified_at, channel_binding.verified_via;
$$;
REVOKE ALL ON FUNCTION channel_set_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION channel_set_status(uuid, text, text) TO cb_app;

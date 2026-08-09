-- b131 — AUTO-RAISE, per bound line. Athi, 2026-08-09: "in reality no one will sit and create a chit from whatsapp,
-- it has to be automatic without anyone's presence. because whatsapp is not formatted, we are giving some formatting
-- for the same, nothing more here."
--
-- ⚠️ DEFAULT FALSE, AND THAT IS DELIBERATE. Every line bound before this migration keeps behaving exactly as it does
-- today: the message lands in Intake and a person presses Raise. Auto-raise is switched on per line, by its owner,
-- knowing what it does — a migration that silently started minting chits on every existing binding would be a
-- behaviour change nobody asked for arriving as a schema change.
--
-- ⚠️ AND IT ONLY EVER APPLIES TO A VERIFIED BINDING. b124 already made channel_owner resolve verified lines only, so
-- a declared-but-unapproved number cannot auto-raise anything however this column is set. Two independent conditions,
-- which is the point: the flag says "I want this", the verification says "this line is really yours".
--
-- channel_owner_binding() returns the whole row the webhook needs, so resolving the owner and reading the flag is ONE
-- SECURITY DEFINER call rather than an owner lookup followed by a context-free SELECT that FORCE RLS would refuse.

ALTER TABLE channel_binding
  ADD COLUMN IF NOT EXISTS auto_raise boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN channel_binding.auto_raise IS
  'b131 — when true AND the binding is verified, an inbound message on this line is structured and raised as a Task with no human present. Off by default.';

CREATE OR REPLACE FUNCTION channel_owner_binding(p_channel text, p_address text)
RETURNS TABLE (entity_id uuid, binding_id uuid, auto_raise boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  -- ⚠️ VERIFIED ONLY, matching channel_owner (b124). A declared binding receives nothing, by design.
  SELECT b.entity_id, b.id, b.auto_raise
    FROM channel_binding b
   WHERE b.channel = p_channel AND lower(b.address) = lower(p_address) AND b.status = 'verified'
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION channel_owner_binding(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION channel_owner_binding(text, text) TO cb_app;

-- b124: A DECLARED BINDING MUST NOT RECEIVE. Closes the ownership gap left open by b123.
--
-- b123 let any entity bind any address, first-claim-wins, and the webhook resolved on the binding alone. So if
-- entity A claimed a number that really belonged to entity B — and that number was live under the platform's
-- WhatsApp account — A would have received B's customers' messages. Nothing in the product stopped it; `status`
-- existed as a rung and nothing read it. Declared-but-unenforced, which is the failure mode this codebase keeps
-- writing down and then repeating.
--
-- ⚠️ WHY VERIFICATION CANNOT BE SELF-SERVICE HERE. The obvious fix — mail a code to the number and have them send
-- it back — does not work for an INBOUND business line. The claimant is the one shown the code, and the number is
-- reachable by anyone, so A can simply message B's number with A's own code and verify A's claim on B's number.
-- A challenge is only proof when the claimant cannot also satisfy it.
--
-- The honest authority is whoever PROVISIONS the number. In the platform-owned model that is the platform: numbers
-- are onboarded into our WhatsApp Business Account, and Meta tells us at that moment whose they are. So `verified`
-- is granted by the platform (or, later, straight from the Meta onboarding handshake) — never by the claimant.
--
-- This migration changes ONE thing: channel_owner() now answers only for VERIFIED bindings. A declared binding is
-- a claim, visible to its owner in Settings → Channels, and inert. Nothing is deleted; existing rows keep their
-- status, which means every b123 binding stops resolving until it is approved. That is the intended direction:
-- fail closed.
ALTER TABLE channel_binding ADD COLUMN IF NOT EXISTS verified_via text;   -- platform | meta_onboarding

CREATE OR REPLACE FUNCTION channel_owner(p_channel text, p_address text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT entity_id FROM channel_binding
   WHERE channel = p_channel
     AND lower(address) = lower(p_address)
     AND status = 'verified'        -- ⚠️ THE WHOLE POINT OF b124. A claim is not a permission.
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION channel_owner(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION channel_owner(text, text) TO cb_app;

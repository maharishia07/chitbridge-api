-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
-- b162 — DELIVER A PRODUCT ENQUIRY (backlog 9, case 2: business → supplier, both sides entities).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Athi, 2026-08-16: *"need to have a quick enquiry about the product or details about it, so having a message
-- layer for products will be good… it is an enquiry."*
--
-- b161 generalised the ANCHOR (`subject_type`/`subject_id`, nullable `chit_id`). This adds the only thing still
-- missing: DELIVERY. `chit_message_deliver` decides its audience from `chit_status` — the chit's participants —
-- and a product enquiry has no chit, so it has no audience to read. This function knows the enquiry audience
-- instead: the ASKER and the product's OWNER.
--
-- ── ⭐ WHY A SECOND DEFINER RATHER THAN TWO PLAIN INSERTS ────────────────────────────────────────────────────────
-- The API could open a transaction per side and insert directly. It must not. Writing the asker's message into
-- the SUPPLIER's copy is a cross-entity write, and the whole b103 root principle is that identity and authority
-- come from the server's TRUSTED context and never from a parameter. Doing it in the route would mean the route
-- setting `app.current_entity` to an entity that is not the caller — which is the exact escalation the definers
-- exist to prevent. So this follows the b50/b103 standard exactly:
--   read v_caller from app.current_entity · FAIL CLOSED if absent · VERIFY the claimed sender equals the caller.
--
-- ⚠️ AND IT VERIFIES THE ASKER MAY SEE THE PRODUCT AT ALL. Otherwise the function is an oracle: enquire about a
-- random uuid and the success or failure of the call tells you whether that product exists and who owns it.
-- The check is the same one the catalogue read uses — the item must be visible to the caller.
--
-- ── WHAT IT DOES NOT DO ─────────────────────────────────────────────────────────────────────────────────────────
-- ⚠️ CASE 1 (a public storefront customer, who is NOT a CB entity) IS NOT HANDLED HERE, deliberately. Answering
-- them needs channel-outbound, and that path has no receipt yet — building the inbound half alone would invite a
-- conversation on the storefront that the business cannot hold up its end of. Cases 1 and 4 ship together, after
-- outbound is proven.
-- ⚠️ CASE 3 (an enquiry with no product at all) is not handled either: b161's CHECK requires a subject_id for
-- `product`, and whether a subject-less enquiry is a message or just a chit with no lines is an open question.
--
-- ⚠️ WITH RLS, unchanged. Every row written here carries `entity_id` and is governed by the existing
-- `chit_messages` policy exactly as a chit message is. Per-copy, because a conversation is mutable and
-- disputable and a shared row would make one party the sole holder of what was said.
--
-- Idempotent (CREATE OR REPLACE). Safe to re-run.

BEGIN;

CREATE OR REPLACE FUNCTION enquiry_message_deliver(
  p_message_id uuid, p_subject_id uuid, p_sender_entity_id uuid, p_sender_display_name text,
  p_thread_type text, p_message_text text, p_msg_type text
) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_created timestamptz := now();
  v_caller  uuid;
  v_owner   uuid;
  v_ent     uuid;
BEGIN
  -- ── the b50/b103 standard: authority from the trusted context, never from a parameter ──
  v_caller := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'enquiry_message_deliver: no entity context — call inside withEntity(sender)'; END IF;
  IF p_sender_entity_id IS DISTINCT FROM v_caller THEN
    RAISE EXCEPTION 'enquiry_message_deliver: claimed sender % <> caller %', p_sender_entity_id, v_caller; END IF;

  -- ⚠️ WHO OWNS THE PRODUCT. Read WITHOUT the caller's RLS (this is a definer) so the owner can be resolved even
  -- though the asker does not own the row — but the visibility check below is what makes that safe.
  SELECT entity_id INTO v_owner FROM catalogue_items WHERE item_id = p_subject_id LIMIT 1;
  IF v_owner IS NULL THEN
    -- ⚠️ SAME ERROR FOR "does not exist" AND "you cannot see it" — see below. Never leak which.
    RAISE EXCEPTION 'enquiry_message_deliver: no such product, or it is not visible to you';
  END IF;

  /* ⚠️⚠️ THE ORACLE GUARD. Without it, enquiring about a random uuid would answer "does this product exist, and
     who owns it" purely from whether the call succeeded. A product you cannot see must be as unaskable as one
     that does not exist, and must fail the SAME way — same message, no distinction.

     ⚠️⚠️ THIS GUARD IS DELIBERATELY STRICTER THAN THE REAL VISIBILITY RULE, AND THAT IS THE DESIGN.
     The full rule lives in lib/catalogue-view.js `catalogueVisibility()` and involves a plan CAP and network
     membership — application logic that cannot be faithfully mirrored in plpgsql. Reimplementing it here would
     create exactly the second definition this codebase keeps paying to remove, and the copy would drift.

     So this asks only a NECESSARY condition that cannot be bypassed: your own product · a PUBLIC catalogue · or
     an existing relationship either way round. `network` visibility is NOT accepted here, so a network member
     with no link is refused by the definer even though the full rule would allow them. Being stricter is the
     safe direction for a backstop — it can never grant more than the real gate. The ROUTE applies the full
     rule; this is the floor under it, not a copy of it. */
  IF v_owner <> v_caller
     AND NOT EXISTS (
       SELECT 1 FROM identities i
        WHERE i.identity_id = v_owner
          AND COALESCE(i.catalogue_visibility, 'private') = 'public')
     AND NOT EXISTS (
       SELECT 1 FROM supplier_list sl
        WHERE sl.owner_entity_id = v_caller AND sl.supplier_entity_id = v_owner)
     AND NOT EXISTS (
       SELECT 1 FROM customer_list cl
        WHERE cl.owner_entity_id = v_owner AND cl.customer_identity_id = v_caller)
  THEN
    RAISE EXCEPTION 'enquiry_message_deliver: no such product, or it is not visible to you';
  END IF;

  -- ── internal note: a single private copy, exactly as a chit-internal message ──
  IF p_thread_type = 'internal' THEN
    INSERT INTO chit_messages (message_id, entity_id, chit_id, subject_type, subject_id,
        sender_entity_id, sender_display_name, thread_type, visibility_entity_id,
        message_text, msg_type, is_dispute, dispute_id, created_at)
      VALUES (p_message_id, v_caller, NULL, 'product', p_subject_id,
        v_caller, p_sender_display_name, 'internal', v_caller,
        p_message_text, COALESCE(p_msg_type,'info'), false, NULL, v_created);
    RETURN v_created;
  END IF;

  /* ── external: one copy for the asker, one for the owner ──
     ⚠️ DISTINCT, because a business enquiring about its OWN product is a real case (testing the storefront,
     or a co-assist asking) and must produce ONE copy, not two identical rows under one entity — the same
     self-chit lesson chit_message_deliver already learned. */
  FOR v_ent IN SELECT DISTINCT e FROM unnest(ARRAY[v_caller, v_owner]) AS e LOOP
    INSERT INTO chit_messages (message_id, entity_id, chit_id, subject_type, subject_id,
        sender_entity_id, sender_display_name, thread_type, visibility_entity_id,
        message_text, msg_type, is_dispute, dispute_id, created_at)
      VALUES (p_message_id, v_ent, NULL, 'product', p_subject_id,
        v_caller, p_sender_display_name, 'external', NULL,
        p_message_text, COALESCE(p_msg_type,'info'), false, NULL, v_created);
  END LOOP;

  RETURN v_created;
END; $$;

GRANT EXECUTE ON FUNCTION enquiry_message_deliver(uuid,uuid,uuid,text,text,text,text) TO cb_app;

COMMIT;

DO $$
BEGIN
  RAISE NOTICE 'b162: enquiry_message_deliver installed. Product enquiries (backlog 9 case 2) can now be delivered per-copy.';
END $$;

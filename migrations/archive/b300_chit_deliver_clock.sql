-- b300_chit_deliver_clock.sql — round Y1b: chit_deliver stamps a copy's sent_at / created_at from the COPY when it carries them,
--                               NOW() as before when it does not. No new table, no new column, no data touched.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres — CREATE OR REPLACE FUNCTION on a SECURITY DEFINER
--    function needs its owner; cb_app cannot). Written offline, read, never executed here. Safe to re-run (one CREATE OR REPLACE).
--    Until it runs, nothing breaks: routes/chits.js now hands the moment to lib/mint.js as two more jsonb keys the old function
--    simply does not read, so every copy is stamped NOW() exactly as before. tools/sim-load.cjs checks for this function's
--    new shape (pg_get_functiondef) and refuses, in words, to load a three-year shop that would be dated "today".
--
-- RLS: unchanged — the function is the b50 delivery agent (SECURITY DEFINER, search_path public) with the SAME isolation gate
--    at the top ("a tenant may only deliver chits it sends"); every INSERT below is b142's, byte for byte, except the two
--    stamps in the chit_header VALUES. No policy is added, dropped or relaxed.
--
-- WHY (lib/shop-clock.js, Y1 2026-10-10): "a posting path never says new Date(): it says clock.now()". The route already did
--    (routes/chits.js: `const now = CLOCK.now()`), but the row's created_at came from SQL NOW(), so a bill the simulator sent on
--    2027-08-10 landed on today — the counter's bill list, CRM's last-seen and the walk-in day's bounds (books-store.counterBills
--    reads billed_at, else created_at) all read the wrong day. In life the clock IS the system clock: the stamp is the same moment
--    NOW() would have given, within the request.
--
-- THE ZONE (M210, b299_created_at_timestamptz.sql — written the same week, numbered first): the copy's stamp is an ISO instant
--    ('…Z', lib/mint.js isoOf) cast to timestamptz, so it names ONE moment whatever the session zone. Into the column it goes
--    exactly as NOW() does: before b299 the column is naive and the cast uses the session zone, which db/index.js pins to UTC on
--    connect and in every BEGIN (withEntity) — a UTC wall clock, the convention b299's `AT TIME ZONE 'UTC'` rests on; after b299
--    the column is timestamptz and the instant is stored as it is. b299 and b300 may run in either order.

CREATE OR REPLACE FUNCTION chit_deliver(p_chit_id uuid, p_clear_first boolean, p_copies jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sender uuid := NULLIF(current_setting('app.current_entity', true), '')::uuid;
  c jsonb;
BEGIN
  IF v_sender IS NULL THEN
    RAISE EXCEPTION 'chit_deliver: no entity context (app.current_entity unset) — call inside withEntity(sender)';
  END IF;

  FOR c IN SELECT value FROM jsonb_array_elements(p_copies) AS value LOOP
    IF (c->>'sender_entity_id')::uuid IS DISTINCT FROM v_sender THEN
      RAISE EXCEPTION 'chit_deliver: copy sender % <> caller % (a tenant can only deliver chits it sends)',
        c->>'sender_entity_id', v_sender;
    END IF;
  END LOOP;

  IF p_clear_first THEN
    DELETE FROM state_log   WHERE chit_id = p_chit_id AND entity_id = v_sender;
    DELETE FROM chit_line   WHERE chit_id = p_chit_id AND entity_id = v_sender;
    DELETE FROM chit_detail WHERE chit_id = p_chit_id AND entity_id = v_sender;
    DELETE FROM chit_status WHERE chit_id = p_chit_id AND entity_id = v_sender;
    DELETE FROM chit_header WHERE chit_id = p_chit_id AND entity_id = v_sender;
  END IF;

  FOR c IN SELECT value FROM jsonb_array_elements(p_copies) AS value LOOP
    INSERT INTO chit_header
      (chit_id, entity_id, sender_entity_id, sender_entity_bridge_id, sender_entity_display_name,
       all_recipients, purpose, auto_subject, manual_subject, summary_json, business_json,
       schema_version, schema_id, created_by_actor_id, role, chit_ref, direction, sent_at, created_at)
    VALUES
      (p_chit_id, (c->>'entity_id')::uuid, v_sender, c->>'sender_entity_bridge_id', c->>'sender_entity_display_name',
       COALESCE(c->'all_recipients', '[]'::jsonb), c->>'purpose', c->>'auto_subject', c->>'manual_subject',
       c->'summary_json', c->'business_json',
       c->>'schema_version', (c->>'schema_id')::uuid, (c->>'created_by_actor_id')::uuid,
       c->>'role', p_chit_id, c->>'direction',
       -- ⭐ b300: the shop clock's moment when the copy carries it (routes/chits.js → lib/mint.js), NOW() otherwise
       COALESCE(NULLIF(c->>'sent_at', '')::timestamptz, NOW()),
       COALESCE(NULLIF(c->>'created_at', '')::timestamptz, NOW()));

    INSERT INTO chit_detail
      (chit_id, entity_id, detail_type, line_item_count, total_value, currency_code, line_items,
       direction, payload_delivered_at)
    VALUES
      (p_chit_id, (c->>'entity_id')::uuid, c->>'detail_type', COALESCE((c->>'line_item_count')::int, 0),
       COALESCE((c->>'total_value')::numeric, 0), COALESCE(c->>'currency_code', 'INR'), c->'line_items',
       c->>'direction', CASE WHEN (c->>'payload_delivered') = 'true' THEN NOW() ELSE NULL END);

    -- ⭐ THE LINES, as rows, for THIS copy (b142).
    IF jsonb_typeof(c->'line_items') = 'array' THEN
      INSERT INTO chit_line (chit_id, entity_id, line_id, seq, particulars, quantity, unit, unit_size, price,
                             comment, asked_as, asked_unit, raw_phrase, needs_human, flags)
      SELECT p_chit_id, (c->>'entity_id')::uuid,
             COALESCE(NULLIF(li.value->>'line_id','')::uuid, cb_line_id(p_chit_id, li.ord::int)),
             COALESCE((li.value->>'seq')::int, li.ord::int * 10),
             li.value->>'particulars',
             NULLIF(li.value->>'quantity','')::numeric,
             NULLIF(li.value->>'unit',''), NULLIF(li.value->>'unit_size',''),
             NULLIF(li.value->>'price','')::numeric, NULLIF(li.value->>'comment',''),
             NULLIF(li.value->>'asked_as',''), NULLIF(li.value->>'asked_unit',''),
             NULLIF(li.value->>'raw_phrase',''),
             COALESCE((li.value->>'needs_human')::boolean, false),
             CASE WHEN li.value ? 'qty_unverified' OR li.value ? 'variant_unspecified'
                  THEN jsonb_strip_nulls(jsonb_build_object(
                         'qty_unverified', li.value->'qty_unverified',
                         'variant_unspecified', li.value->'variant_unspecified'))
                  ELSE NULL END
        FROM jsonb_array_elements(c->'line_items') WITH ORDINALITY AS li(value, ord)
      ON CONFLICT (entity_id, chit_id, line_id) DO NOTHING;
    END IF;

    INSERT INTO chit_status (chit_id, entity_id, current_status, direction, priority_flag)
    VALUES
      (p_chit_id, (c->>'entity_id')::uuid, c->>'current_status', c->>'direction',
       COALESCE(c->>'priority_flag', 'normal'));

    IF c ? 'log' AND c->'log' IS NOT NULL THEN
      INSERT INTO state_log
        (chit_id, entity_id, action, action_by_identity_id, action_by_display_name, new_status, detail)
      VALUES
        (p_chit_id, (c->>'entity_id')::uuid, c->'log'->>'action', (c->'log'->>'action_by_identity_id')::uuid,
         c->'log'->>'action_by_display_name', c->'log'->>'new_status', c->'log'->>'detail');
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF position('created_at' in pg_get_functiondef('chit_deliver(uuid,boolean,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'b300: chit_deliver was not replaced';
  END IF;
  RAISE NOTICE 'b300: chit_deliver honours a copy''s own sent_at / created_at (the shop clock); NOW() when absent. No data touched.';
END $$;

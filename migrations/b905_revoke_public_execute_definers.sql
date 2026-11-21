-- b905_revoke_public_execute_definers.sql — no SECURITY DEFINER function in schema public is executable by PUBLIC; cb_app keeps exactly the ones the api calls (VERIFY-EL-DB A4, batch 1128).
--
-- ⚠️ NOT RUN · Athi runs it (Supabase SQL editor, AS postgres), SIT first. Safe to repeat. Changes privileges only: no function body, no row, no table.
-- WHY  42 of 58 definers carried the default PUBLIC EXECUTE (only the ones whose file said REVOKE had it removed). A definer runs with its owner's rights (past RLS), so who may call it matters:
--      if the Supabase Data API still exposes schema public to anon, PUBLIC EXECUTE is a way in. (ops/metrics functions are not touched: PUBLIC has no USAGE on those schemas.)
-- WHAT  a loop over pg_proc (schema public, prosecdef, not part of an extension), so functions added after the baseline (review_mark_*, mark_notices, ...) are covered too:
--       1. REVOKE ALL ON FUNCTION ... FROM PUBLIC.
--       2. GRANT EXECUTE ... TO cb_app for exactly these names, each one called by the code (git grep in routes/ lib/ src/, 21 Nov): ai_global_spend_today, channel_owner,
--          channel_owner_binding, channel_set_status, chit_deliver, chit_dispute_deliver, chit_dispute_resolve, chit_dispute_roster, chit_line_delivered_qty, chit_line_event,
--          chit_log_all, chit_log_targets, chit_message_deliver, chit_message_mark, chit_participant_parity, chit_participants, chit_set_customer_priority_all, chit_sla_pause_answer,
--          chit_sla_pause_end, chit_sla_pause_start, enquiry_message_deliver, network_search, notif_mark_seen, state_log_fanout, review_mark_set, review_mark_post, mark_notices.
--       Not granted by this file (no caller in the code): wallet_topup, chit_set_status_all (they keep any direct cb_app grant they already have), and the trigger functions
--       (cb_catalogue_version_cut, identities_stamp_world, retention_apply_dispute_floor, state_log_refuse_delete): a trigger function needs no EXECUTE grant to fire.
-- ORDER safe at any time: cb_app already holds direct grants on these (baseline); the explicit GRANT also covers any that only had PUBLIC.
-- RLS: untouched. ROLL BACK: GRANT EXECUTE ON FUNCTION <name>(<args>) TO PUBLIC;  (one per function; every one is a NOTICE line of this file)
-- CHECK (read-only): SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('public', p.oid, 'EXECUTE');   (0 rows)
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$
DECLARE r record;
  called text[] := ARRAY['ai_global_spend_today','channel_owner','channel_owner_binding','channel_set_status','chit_deliver','chit_dispute_deliver','chit_dispute_resolve','chit_dispute_roster',
    'chit_line_delivered_qty','chit_line_event','chit_log_all','chit_log_targets','chit_message_deliver','chit_message_mark','chit_participant_parity','chit_participants',
    'chit_set_customer_priority_all','chit_sla_pause_answer','chit_sla_pause_end','chit_sla_pause_start','enquiry_message_deliver','network_search','notif_mark_seen','state_log_fanout',
    'review_mark_set','review_mark_post','mark_notices'];
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig, p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.prosecdef
              AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    IF r.proname = ANY(called) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO cb_app', r.sig);
    END IF;
    RAISE NOTICE 'b905: % revoked from PUBLIC%', r.sig, CASE WHEN r.proname = ANY(called) THEN ', granted to cb_app' ELSE '' END;
  END LOOP;
END $$;
COMMIT;

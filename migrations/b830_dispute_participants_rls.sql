-- b830_dispute_participants_rls.sql — SEC-105 (29 Oct 2026): row security on dispute_participants, the one dispute table that had none.
--
-- ⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run. Touches no rows.
--
-- WHY. chit_disputes has FORCE RLS (rls_entity); dispute_participants did not, so a connection that skips policies read every shop's participants.
-- NOTHING reads it: routes/chits.js:5476 says "dispute_participants retired", the roster comes from chit_dispute_roster() (SECURITY DEFINER over chit_disputes).
-- So the policy cannot break a screen. Same policy text as chit_disputes.
-- AFTER Athi runs it: db/rls-baseline.json (dispute_participants rls true, forced true, policies 1) and the db/index.js force-RLS list are updated by cb-db in the same step.
ALTER TABLE public.dispute_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispute_participants FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON public.dispute_participants;
CREATE POLICY rls_entity ON public.dispute_participants
  USING (entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid)
  WITH CHECK (entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid);

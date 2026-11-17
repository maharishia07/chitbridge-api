-- b791_ctp_return_path.sql — RAIL-106 (takes in RAIL-114): the CTP RETURN PATH (25 Oct 2026, Athi's decision "Transparent across installations", DECISIONS.md 2026-10-25 09:10).
--
-- ⚠️⚠️ DRAFT — NOT RUN IN PRODUCTION · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS then CREATE).
--    The SIT kit's migrate job runs it on the SIT VMs. Touches no existing rows: two new tables and one function. Code checks the tables (schema.hasTable) and behaves exactly
--    as before (nothing queued, nothing marked) until this has run.
--
-- OWNER: lib/ctpreturn.js (ctp_event_out, ctp_event_in)
--
-- WHY. After a chit crossed to another installation, a status change or an external message made on one side never reached the other (SIT run 2026-10-25, runs 2 and 4).
-- Each change now travels as a signed EVENT envelope through the same door as a delivery; the receiver applies it to ITS OWN rows (a shadow of the other party's chit_status
-- row, its own copy of the message). Two tables carry that:
--   ctp_event_out   the sender's QUEUE. One row per (change, remote party). Written in the changer's own transaction context, resent by tools/ctp-return.cjs until the far
--                   side accepts. Sequence per (chit_id, from_entity_id): shared by the rows of one change, so the far side can ignore an older or repeated event.
--                   While a row is not 'accepted' the changer's own copy says "not yet confirmed to the other side" (lib/ctpreturn.js unconfirmed).
--   ctp_event_in    the receiver's WATERMARK. Per (chit, remote party, local party): the highest status event applied, so an older or repeated one is ignored (idempotent).
--                   A message is idempotent on its message_id and needs no watermark.
-- Neither table holds anything the other side did not already see: a status word and an EXTERNAL message (both parties' content by definition). Internal notes and disputes
-- never go in (a dispute on a chit with a party elsewhere is refused in words, CTP_CROSS_DISPUTE).
--
-- RLS: both tables ENABLE + FORCE ROW LEVEL SECURITY with the rls_entity shape every chit table has (entity_id = app.current_entity), plus the owner policy b790 uses so the SECURITY
-- DEFINER function below (owner postgres) can list due rows across entities. The app role never lists the whole queue: the retry job calls ops.f_ctp_event_due() and then
-- updates each row under withEntity(its own sender).
-- Grants: default privileges give cb_app SELECT + INSERT on new tables; UPDATE is granted where a writer needs it. No DELETE: the queue is a record, accepted rows stay.

BEGIN;

CREATE TABLE IF NOT EXISTS ctp_event_out (
  id                 bigserial PRIMARY KEY,
  chit_id            uuid        NOT NULL,
  from_entity_id     uuid        NOT NULL,                       -- the local party who made the change (this is the RLS key)
  seq                bigint      NOT NULL CHECK (seq >= 1),       -- per (chit_id, from_entity_id); every row of one change carries the same seq
  kind               text        NOT NULL CHECK (kind IN ('status', 'message')),
  event              jsonb       NOT NULL CHECK (jsonb_typeof(event) = 'object'),
  to_entity_id       uuid        NOT NULL,                       -- the remote party's local stub row
  to_bridge_id       text        NOT NULL,
  to_installation_key text       NOT NULL,
  status             text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'failed')),
  attempts           integer     NOT NULL DEFAULT 0,
  next_try_at        timestamptz NOT NULL DEFAULT now(),
  last_error         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  accepted_at        timestamptz,
  CONSTRAINT ctp_event_out_one_per_party UNIQUE (chit_id, from_entity_id, seq, to_bridge_id)
);
CREATE INDEX IF NOT EXISTS ctp_event_out_due_idx ON ctp_event_out (chit_id, from_entity_id, to_bridge_id, seq) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS ctp_event_out_mine_idx ON ctp_event_out (from_entity_id, chit_id) WHERE status <> 'accepted';
COMMENT ON TABLE ctp_event_out IS 'RAIL-106 b791: the CTP return path queue. One row per change per remote party, resent until the far installation accepts. kind status|message; event is the signed payload (lib/ctpreturn.js). Never an internal note or a dispute.';

CREATE TABLE IF NOT EXISTS ctp_event_in (
  chit_id          uuid        NOT NULL,
  remote_entity_id uuid        NOT NULL,                         -- the local stub row of the party on the other installation
  entity_id        uuid        NOT NULL,                         -- the local party the event was for (this is the RLS key)
  last_seq         bigint      NOT NULL CHECK (last_seq >= 1),
  applied_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chit_id, remote_entity_id, entity_id)
);
CREATE INDEX IF NOT EXISTS ctp_event_in_entity_idx ON ctp_event_in (entity_id, chit_id);
COMMENT ON TABLE ctp_event_in IS 'RAIL-106 b791: the highest status event applied per (chit, remote party, local party). An event with seq <= last_seq is acknowledged and ignored.';

-- ── RLS ────────────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE ctp_event_out ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctp_event_out FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ctp_event_out_owner ON ctp_event_out;
CREATE POLICY ctp_event_out_owner ON ctp_event_out USING (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text)) WITH CHECK (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text));
DROP POLICY IF EXISTS rls_entity ON ctp_event_out;
CREATE POLICY rls_entity ON ctp_event_out TO cb_app
  USING (from_entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid)
  WITH CHECK (from_entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid);

ALTER TABLE ctp_event_in ENABLE ROW LEVEL SECURITY;
ALTER TABLE ctp_event_in FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ctp_event_in_owner ON ctp_event_in;
CREATE POLICY ctp_event_in_owner ON ctp_event_in USING (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text)) WITH CHECK (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text));
DROP POLICY IF EXISTS rls_entity ON ctp_event_in;
CREATE POLICY rls_entity ON ctp_event_in TO cb_app
  USING (entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid)
  WITH CHECK (entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid);

GRANT SELECT, INSERT, UPDATE ON ctp_event_out, ctp_event_in TO cb_app;
GRANT USAGE, SELECT ON SEQUENCE ctp_event_out_id_seq TO cb_app;

-- ── the retry job's one cross-entity read ──────────────────────────────────────────────────────────────────
-- The OLDEST pending event of each (chit, sender, remote party) whose time has come: head-of-line, so an event never overtakes an earlier one of its own stream. A failed
-- row (retries spent) does not block the ones behind it. The job then sends each and updates its row under withEntity(from_entity_id).
CREATE OR REPLACE FUNCTION ops.f_ctp_event_due(p_limit integer) RETURNS SETOF public.ctp_event_out
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $$
  SELECT h.* FROM (
    SELECT DISTINCT ON (chit_id, from_entity_id, to_bridge_id) *
      FROM public.ctp_event_out
     WHERE status = 'pending'
     ORDER BY chit_id, from_entity_id, to_bridge_id, seq
  ) h
  WHERE h.next_try_at <= now()
  ORDER BY h.next_try_at, h.id
  LIMIT greatest(coalesce(p_limit, 50), 1)
$$;
REVOKE ALL ON FUNCTION ops.f_ctp_event_due(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.f_ctp_event_due(integer) TO cb_app;

COMMIT;

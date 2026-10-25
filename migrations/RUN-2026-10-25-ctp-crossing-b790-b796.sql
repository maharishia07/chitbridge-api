-- RUN-2026-10-25-ctp-crossing-b790-b796.sql — production, Supabase SQL editor (as postgres). Paste ALL, Run once.
-- b790 → b791 → b792 → b793 → b796, in this order (b792/b793/b796 each widen the same CHECK; the last one wins and lists every kind).
-- Every block is safe to re-run and touches no existing rows. Source: chitbridge-api branch sit/grundfos 6c48f0f1, migrations/.
-- When it finishes, the last query must print 5 rows of 't'. Then tell Claude: "ran b790-b796".

-- ==================== b790_network_member.sql ====================
-- b790_network_member.sql — PLT-45 / RAIL-96 / RAIL-97 (25 Oct 2026): the network master, the membership certificate and the registry mirror.
--
-- ⚠️⚠️ DRAFT — NOT RUN IN PRODUCTION · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS then CREATE).
--    The SIT kit's migrate job runs it on the SIT VMs. Touches no existing rows: one defaulted column and new tables. Code checks the tables (schema.hasTable) and
--    behaves as a standalone installation until this has run.
--
-- WHY. An installation states WHO IT IS in `installation` (domain, key, country). The network adds facts that are ids and counts, never owned data:
--   installation.network_role   standalone (default) | member | master. Data, not code: a master ALSO needs the network root signing key (CB_NETWORK_ROOT_KEY) in its environment.
--   membership_certificate      the pass the master signs for an installation (master: the ones it issued; member: the copy it holds). Short life.
--   network_revoked             serials the master has suspended or revoked; a member pulls the signed list (lib/netsync).
--   registry_change             the member's OUTBOX: one row per entity created or changed, written by ONE trigger in the entity's own transaction. The master pulls by sequence.
--   registry_entry / registry_cursor   the master's mirror: (installation_key, bridge_id) with type, population, status, and how far it has read each member.
--   installation.root_handle / root_bridge_id   the master's note of each member's root entity (cb<scope><nn>-root); the master allocates the next number.
-- A bridge id is unique inside ONE database only, so the mirror's key is the pair (installation_key, bridge_id) (critic 25 Oct, point 2).
-- A registry entry holds NO handle, name, contact, address, tax number, money or chit (DPDP / AU APP 8 / GDPR: pseudonymous ids and counts only).
-- OWNER: lib/netmember.js (role, certificate, answers) · lib/netsync.js (the pulls) · tools/network-cert.cjs (the operator's CLI).
-- RLS: all five new tables ENABLE + FORCE ROW LEVEL SECURITY. They hold platform facts, not a shop's, so the app role (cb_app) reads and writes them through one
--    policy each; registry_change is WRITTEN only by the SECURITY DEFINER trigger function (owner postgres) and READ by cb_app. There is no entity_id column to isolate on,
--    and every column is an id, a status or a count.
-- Grants: default privileges give cb_app SELECT + INSERT on new tables; UPDATE and DELETE are granted below only where a writer needs them.

BEGIN;

ALTER TABLE installation ADD COLUMN IF NOT EXISTS network_role text NOT NULL DEFAULT 'standalone';
ALTER TABLE installation ADD COLUMN IF NOT EXISTS root_handle text;
ALTER TABLE installation ADD COLUMN IF NOT EXISTS root_bridge_id text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'installation_network_role_chk' AND conrelid = 'installation'::regclass) THEN
    ALTER TABLE installation ADD CONSTRAINT installation_network_role_chk CHECK (network_role IN ('standalone', 'member', 'master'));
  END IF;
END $$;
COMMENT ON COLUMN installation.network_role IS 'PLT-45 b790: standalone (default, nothing changes) | member (a master is pinned) | master (also holds CB_NETWORK_ROOT_KEY). The label; the key is the capability.';
COMMENT ON COLUMN installation.root_handle IS 'PLT-45 b790: on the MASTER, the handle of a member installation''s root entity (cb<scope><nn>-root). A handle is a label; the uuid is the identity.';
COMMENT ON COLUMN installation.root_bridge_id IS 'PLT-45 b790: on the MASTER, the bridge id of a member installation''s root entity (opaque; unique only inside that member).';

CREATE TABLE IF NOT EXISTS membership_certificate (
  serial           text PRIMARY KEY,
  installation_key text NOT NULL,
  cert             jsonb NOT NULL CHECK (jsonb_typeof(cert) = 'object'),
  signature        text NOT NULL,
  not_before       timestamptz NOT NULL,
  not_after        timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),
  issued_at        timestamptz NOT NULL DEFAULT now(),
  note             text
);
CREATE INDEX IF NOT EXISTS membership_certificate_inst_idx ON membership_certificate (installation_key, not_after DESC);
COMMENT ON TABLE membership_certificate IS 'PLT-45 b790: a membership certificate (signed by the network root key). On the master: every one it issued. On a member: the copy it holds for itself, published in its manifest as `membership`.';

CREATE TABLE IF NOT EXISTS network_revoked (
  serial     text PRIMARY KEY,
  reason     text,
  revoked_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE network_revoked IS 'PLT-45 b790: serials the master suspended or revoked. Master: its own list. Member: the last signed list it pulled and verified against the pinned master key.';

CREATE TABLE IF NOT EXISTS registry_change (
  seq         bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  bridge_id   text NOT NULL,
  entity_type text,
  population  text,
  status      text,
  change      text NOT NULL CHECK (change IN ('created', 'status'))
);
COMMENT ON TABLE registry_change IS 'PLT-45 b790: this installation''s outbox for the master''s pull. Written ONLY by ops.f_registry_change (trigger on identities), only when network_role is member or master. Ids and status only.';

CREATE TABLE IF NOT EXISTS registry_entry (
  installation_key text NOT NULL,
  bridge_id        text NOT NULL,
  entity_type      text,
  population       text,
  status           text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  seen_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_key, bridge_id)
);
COMMENT ON TABLE registry_entry IS 'PLT-45 b790: the master''s mirror of a member''s entities: (installation_key, bridge_id), kind, world, status. Never a handle, name, contact or money.';

CREATE TABLE IF NOT EXISTS registry_cursor (
  installation_key text PRIMARY KEY,
  last_seq         bigint NOT NULL DEFAULT 0,
  entities         integer,
  pulled_at        timestamptz,
  last_error       text
);
COMMENT ON TABLE registry_cursor IS 'PLT-45 b790: how far the master has read each member''s registry_change (a sequence number, never a timestamp, so a clock cannot lose a change).';

-- ── RLS ────────────────────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['membership_certificate', 'network_revoked', 'registry_change', 'registry_entry', 'registry_cursor'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_owner', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (pg_has_role(CURRENT_USER, ''postgres''::name, ''MEMBER''::text)) WITH CHECK (pg_has_role(CURRENT_USER, ''postgres''::name, ''MEMBER''::text))', t || '_owner', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_app', t);
  END LOOP;
END $$;
CREATE POLICY membership_certificate_app ON membership_certificate TO cb_app USING (true) WITH CHECK (true);
CREATE POLICY network_revoked_app        ON network_revoked        TO cb_app USING (true) WITH CHECK (true);
CREATE POLICY registry_entry_app         ON registry_entry         TO cb_app USING (true) WITH CHECK (true);
CREATE POLICY registry_cursor_app        ON registry_cursor        TO cb_app USING (true) WITH CHECK (true);
CREATE POLICY registry_change_app        ON registry_change FOR SELECT TO cb_app USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON membership_certificate, network_revoked, registry_entry, registry_cursor TO cb_app;
REVOKE ALL ON registry_change FROM cb_app;
GRANT SELECT ON registry_change TO cb_app;

-- ── the ONE outbox writer ──────────────────────────────────────────────────────────────────────────────────
-- Fires for a REGISTERED business: identity_type 'entity' with a user_id that is not a minted party ('~…'). Remote stubs (a business on another installation, RAIL-101),
-- minted parties and the seeded CBSRC rows have no user_id, so they are never mirrored. Off (one cheap read) unless a locally hosted installation row says member or master.
CREATE OR REPLACE FUNCTION ops.f_registry_change() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public', 'ops'
    AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.installation WHERE hosted_locally AND active AND network_role IN ('member', 'master')) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.registry_change (bridge_id, entity_type, population, status, change)
    VALUES (NEW.bridge_id, NEW.entity_kind, coalesce(NEW.population, 'live'), NEW.status, 'created');
  ELSIF NEW.status IS DISTINCT FROM OLD.status OR coalesce(NEW.population, 'live') IS DISTINCT FROM coalesce(OLD.population, 'live') THEN
    INSERT INTO public.registry_change (bridge_id, entity_type, population, status, change)
    VALUES (NEW.bridge_id, NEW.entity_kind, coalesce(NEW.population, 'live'), NEW.status, 'status');
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION ops.f_registry_change() FROM PUBLIC;

DROP TRIGGER IF EXISTS identities_registry_change ON identities;
CREATE TRIGGER identities_registry_change
  AFTER INSERT OR UPDATE OF status, population ON identities
  FOR EACH ROW
  WHEN (NEW.identity_type = 'entity' AND NEW.user_id IS NOT NULL AND NEW.user_id NOT LIKE '~%')
  EXECUTE FUNCTION ops.f_registry_change();

COMMIT;


-- ==================== b791_ctp_return_path.sql ====================
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


-- ==================== b792_ctp_event_kinds_disputes.sql ====================
-- b792_ctp_event_kinds_disputes.sql — RAIL-106 part 2 (25 Oct 2026): the CTP return path carries DISPUTES (raise, a dispute message, resolve).
--
-- ⚠️⚠️ DRAFT — NOT RUN IN PRODUCTION · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (DROP CONSTRAINT IF EXISTS, then ADD). Touches no rows.
--    The SIT kit's migrate job runs it on the SIT VMs.
-- OWNER: lib/ctpreturn.js (ctp_event_out)
--
-- WHY. b791 limited ctp_event_out.kind to ('status', 'message'). A dispute event is a third and fourth and fifth kind. No new table: chit_disputes, its roster and the dispute-tagged
-- message copies already hold a remote party (it is a stub row here, exactly as for status and messages); only the CHECK on the queue's kind column has to learn the new words.
-- Until this has run, a dispute on a chit with a party elsewhere is saved here and the answer says "could not be queued" (queue insert refused), never silence.

BEGIN;

ALTER TABLE ctp_event_out DROP CONSTRAINT IF EXISTS ctp_event_out_kind_check;
ALTER TABLE ctp_event_out ADD CONSTRAINT ctp_event_out_kind_check
  CHECK (kind IN ('status', 'message', 'dispute_raise', 'dispute_message', 'dispute_resolve'));

COMMIT;


-- ==================== b793_ctp_event_kinds_gaps.sql ====================
-- b793_ctp_event_kinds_gaps.sql — RAIL-106 part 3 (25 Oct 2026): the CTP return path carries the CANCEL FLAGS (a request, a confirmation) and ATTACHMENTS.
--
-- ⚠️⚠️ DRAFT — NOT RUN IN PRODUCTION · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (DROP CONSTRAINT IF EXISTS, then ADD). Touches no rows.
--    The SIT kit's migrate job runs it on the SIT VMs.
-- OWNER: lib/ctpreturn.js (ctp_event_out)
--
-- WHY. b792 limited ctp_event_out.kind to status, message and the three dispute kinds. Part 3 adds: cancel_request (the flag "cancel requested" on a recipient's copy, b195),
-- cancel_confirm (the flag "cancel confirmed" on the sender's copy, b197) and attachment (a file on a chit or a message, carried by reference and pulled over the CTP door).
-- No new table. Until this has run the three are saved locally and the answer says "could not be queued" (the insert is refused), never silence.

BEGIN;

ALTER TABLE ctp_event_out DROP CONSTRAINT IF EXISTS ctp_event_out_kind_check;
ALTER TABLE ctp_event_out ADD CONSTRAINT ctp_event_out_kind_check
  CHECK (kind IN ('status', 'message', 'dispute_raise', 'dispute_message', 'dispute_resolve', 'cancel_request', 'cancel_confirm', 'attachment'));

COMMIT;


-- ==================== b796_chit_proposal.sql ====================
-- b796_chit_proposal.sql — RAIL-106 part 4 (25 Oct 2026): ONE proposal mechanism for the seller's pro-forma, the buyer's counter and an amendment after agreement.
--
-- ⚠️⚠️ DRAFT — NOT RUN IN PRODUCTION · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (IF NOT EXISTS, DROP POLICY IF EXISTS then CREATE, DROP CONSTRAINT IF EXISTS then ADD).
--    The SIT kit's migrate job runs it on the SIT VMs. Touches no existing rows. Code checks the table (schema.hasTable) and refuses a proposal in words until this has run.
-- OWNER: lib/chit-proposal.js (chit_proposal)
-- schema-lint: allow R5 tax_note is a sentence ("Tax not decided: …"), not an amount
--
-- WHY A TABLE, AND WHY NOT chit_line_amendment. A proposal is a whole version of the chit's lines AND its priced invoice, in a round, waiting for the other party to accept, counter or reject.
-- chit_line_amendment is the APPLIED correction of one line (a row per line, the latest seq is live, every reader — liveSet, the work list, the delivery guards — treats every row as true now);
-- a proposed row there would read as agreed. It has no status, no round, no invoice. So a proposal waits in its own table and, on acceptance, is applied THROUGH chit_line_amendment
-- (lib/amend record, the one writer of corrections) and the header's invoice and money are set from the proposal, byte for byte.
-- Per copy, like every chit table: each party holds its own row of the same proposal_id (the other installation writes its own through the return path; one installation writes both).
--
-- RLS: ENABLE + FORCE, the rls_entity shape every chit table has (entity_id = app.current_entity).
-- Also widens ctp_event_out_kind_check (b791..b793) with the two kinds the return path carries for it: proposal, proposal_decide.

BEGIN;

CREATE TABLE IF NOT EXISTS chit_proposal (
  proposal_id      uuid        NOT NULL,
  entity_id        uuid        NOT NULL,                       -- whose copy of the proposal this row is (the RLS key)
  chit_id          uuid        NOT NULL,
  round            integer     NOT NULL CHECK (round >= 1),     -- ONE chit per deal: the chit (the buyer's request) is round 1, every version after it is the next round (2 = the seller's priced reply, 3 = a counter…)
  kind             text        NOT NULL CHECK (kind IN ('pro_forma', 'change', 'request', 'terms')),
                                                                -- terms = a money-free round · pro_forma = the seller prices the buyer's request · change = an amendment after agreement · request = the buyer asks (items, quantities, wanted price as text): never a computation
  from_entity_id   uuid        NOT NULL,                       -- who proposed it, as a row of THIS database (a stub when the proposer is on another installation)
  from_bridge_id   text        NOT NULL,
  from_name        text,
  status           text        NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'accepted', 'rejected', 'countered', 'superseded')),
  edits            jsonb,                                      -- the lines as corrections (lib/amend prepare shape): applied on acceptance
  terms            jsonb,                                      -- a MONEY-FREE round (a date, a scope, a note): agreed by either party with the other, it becomes business_json.agreed — no price, currency or tax involved
  request          jsonb,                                      -- a buyer's counter: what is asked, as text or numbers, never priced
  invoice          jsonb,                                      -- the INV-01 invoice the SELLER's installation issued for these lines (null when the tax was not decided)
  summary          jsonb,                                      -- { money, total_value } mapped off the invoice by the seller's installation
  currency_code    text,
  tax_note         text,                                       -- 'Tax not decided: …' in words when the seller has no country; never a guessed tax
  base_hash        text,                                       -- a hash of the lines and invoice this was proposed against: a different one at acceptance is STALE
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  decided_at       timestamptz,
  decided_by       text,
  PRIMARY KEY (proposal_id, entity_id)
);
CREATE INDEX IF NOT EXISTS chit_proposal_chit_idx ON chit_proposal (entity_id, chit_id, round, created_at);
COMMENT ON TABLE chit_proposal IS 'RAIL-106 b796: a round of the pro-forma negotiation or a change order. Per copy. Applied through lib/amend on acceptance; the invoice is the seller''s, carried byte for byte.';

ALTER TABLE chit_proposal ENABLE ROW LEVEL SECURITY;
ALTER TABLE chit_proposal FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON chit_proposal;
CREATE POLICY rls_entity ON chit_proposal TO cb_app
  USING (entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid)
  WITH CHECK (entity_id = (NULLIF(current_setting('app.current_entity', true), ''))::uuid);
DROP POLICY IF EXISTS chit_proposal_owner ON chit_proposal;
CREATE POLICY chit_proposal_owner ON chit_proposal USING (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text)) WITH CHECK (pg_has_role(CURRENT_USER, 'postgres'::name, 'MEMBER'::text));

GRANT SELECT, INSERT, UPDATE ON chit_proposal TO cb_app;

ALTER TABLE ctp_event_out DROP CONSTRAINT IF EXISTS ctp_event_out_kind_check;
ALTER TABLE ctp_event_out ADD CONSTRAINT ctp_event_out_kind_check
  CHECK (kind IN ('status', 'message', 'dispute_raise', 'dispute_message', 'dispute_resolve', 'cancel_request', 'cancel_confirm', 'attachment', 'proposal', 'proposal_decide'));

COMMIT;


-- ==================== check ====================
SELECT 'b790 membership_certificate' AS what, to_regclass('public.membership_certificate') IS NOT NULL AS ok
UNION ALL SELECT 'b791 ctp_event_out', to_regclass('public.ctp_event_out') IS NOT NULL
UNION ALL SELECT 'b791 ctp_event_in',  to_regclass('public.ctp_event_in') IS NOT NULL
UNION ALL SELECT 'b796 chit_proposal', to_regclass('public.chit_proposal') IS NOT NULL
UNION ALL SELECT 'b796 kinds widened', pg_get_constraintdef(c.oid) LIKE '%proposal_decide%' FROM pg_constraint c WHERE c.conrelid = 'public.ctp_event_out'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%kind%';

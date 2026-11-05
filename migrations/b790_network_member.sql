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

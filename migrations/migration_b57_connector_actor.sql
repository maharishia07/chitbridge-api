-- migration_b57_connector_actor.sql — L3.1: connector as a first-class ACTOR + its endpoints (connections).
--
-- DESIGN (confirmed from routes/actors.js): actors ARE `identities` rows (identity_type='actor',
-- parent_entity_id=owner, actor_type='human'). A CONNECTOR actor = the same, discriminated by a new
-- `connector_type` (iot|erp). So NO risky change to actor_type/constraints — we add one nullable column and
-- one new table. Idempotent + self-adapting (matches identities.identity_id's real type for the FKs).
-- Committed but NOT applied; run in Supabase when ready (before deploying routes/connectors.js).

ALTER TABLE identities ADD COLUMN IF NOT EXISTS connector_type text;  -- iot|erp; NULL for non-connector identities (marker: connector = connector_type IS NOT NULL)

DO $$
DECLARE iid_type text;
BEGIN
  SELECT format_type(a.atttypid,a.atttypmod) INTO iid_type
    FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   WHERE c.relname='identities' AND a.attname='identity_id' AND a.attnum>0 AND NOT a.attisdropped;
  IF iid_type IS NULL THEN RAISE EXCEPTION 'identities.identity_id not found'; END IF;

  IF to_regclass('public.connector_connection') IS NULL THEN
    EXECUTE format($f$
      CREATE TABLE connector_connection (
        connection_id           bigserial PRIMARY KEY,
        actor_id                %1$s NOT NULL,   -- the connector identities row
        entity_id               %1$s NOT NULL,   -- owner (scoping)
        direction               text NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
        ref                     text NOT NULL,   -- endpoint (erp) or device id (iot)
        schema_ref              text,
        counterparty_entity_id  %1$s,
        retention               text NOT NULL DEFAULT 'never_persist',  -- never_persist|persist_then_purge
        enabled                 boolean NOT NULL DEFAULT true,
        last_seen               timestamptz,
        status                  text NOT NULL DEFAULT 'green',          -- green|amber|red|paused (health, later)
        created_at              timestamptz NOT NULL DEFAULT NOW()
      )$f$, iid_type);
    CREATE INDEX IF NOT EXISTS cc_actor_idx  ON connector_connection(actor_id);
    CREATE INDEX IF NOT EXISTS cc_entity_idx ON connector_connection(entity_id);
    ALTER TABLE connector_connection DISABLE ROW LEVEL SECURITY;  -- app-layer scoped now (query filters entity_id); L3.6 = add a real RLS policy
    RAISE NOTICE 'created connector_connection (actor/entity type %)', iid_type;
  ELSE
    RAISE NOTICE 'connector_connection already present — skipped';
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
    EXECUTE 'GRANT SELECT,INSERT,UPDATE,DELETE ON connector_connection TO cb_app';
    EXECUTE 'GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO cb_app';
    RAISE NOTICE 'granted connector_connection to cb_app';
  END IF;
END $$;

-- verify (expect: connector_connection = a table, and identities.connector_type present)
SELECT to_regclass('public.connector_connection') AS connector_connection,
       (SELECT count(*) FROM information_schema.columns WHERE table_name='identities' AND column_name='connector_type') AS connector_type_col;

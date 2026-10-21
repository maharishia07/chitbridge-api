-- migration_b47_mint_path.sql — UNIFY THE MINT PATH (reviewer #3): one create_from_blueprint(), a blueprint
-- registry, and is_instance_of(); create_helpdesk()/is_helpdesk() become THIN WRAPPERS. Prevents a parallel
-- create_vertical from forking later. Backward compatible — create_helpdesk('GOV-01-Help'…) behaves identically.
-- Idempotent / re-runnable. Run in Supabase.
--
-- A blueprint "pack" is data (jsonb): { "schema_name","schema_type", "fields":[{"name","key","type","required","order"}...] }.
-- Blueprints live in a registry table, so minting a new vertical = one INSERT + create_from_blueprint_key(...).

BEGIN;

-- 1) Blueprint registry — blueprints are DATA, not hardcoded in functions.
CREATE TABLE IF NOT EXISTS blueprints (
  blueprint_key text PRIMARY KEY,
  label         text NOT NULL,
  pack          jsonb NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- seed the HELPDESK blueprint (its canonical schema = 'Assistant Q&A')
INSERT INTO blueprints (blueprint_key, label, pack) VALUES ('helpdesk', 'Helpdesk',
  $pack${
    "schema_name":"Assistant Q&A","schema_type":"custom",
    "fields":[
      {"name":"Question","key":"question","type":"text","required":true,"order":1},
      {"name":"Answer","key":"answer","type":"text","required":true,"order":2},
      {"name":"Context","key":"context","type":"text","required":false,"order":3},
      {"name":"Topics","key":"topics","type":"text","required":false,"order":4},
      {"name":"Fit","key":"fit","type":"text","required":false,"order":5},
      {"name":"Media","key":"media","type":"text","required":false,"order":6}
    ]}$pack$::jsonb)
ON CONFLICT (blueprint_key) DO UPDATE SET label=EXCLUDED.label, pack=EXCLUDED.pack, updated_at=now();

-- 2) Generic "is this entity an instance of a blueprint?" (identified by its canonical schema_name).
CREATE OR REPLACE FUNCTION is_instance_of(p_entity uuid, p_schema_name text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM entity_schemas
     WHERE entity_id = p_entity AND schema_name = p_schema_name AND status = 'active'
  );
$$;

-- 3) THE mint path: entity (idempotent by email, sealed, governed) + the pack's schema + fields.
CREATE OR REPLACE FUNCTION create_from_blueprint(p_name text, p_email text, p_pack jsonb)
RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid; v_schema uuid; v_sname text; v_stype text; f jsonb;
BEGIN
  v_sname := coalesce(p_pack->>'schema_name', 'Blueprint');
  v_stype := coalesce(p_pack->>'schema_type', 'custom');

  SELECT identity_id INTO v_id FROM identities WHERE email = lower(p_email);
  IF v_id IS NULL THEN
    INSERT INTO identities (bridge_id, display_name, email, identity_type, status, sealed)
    VALUES ('BP' || upper(substr(md5(random()::text), 1, 8)), p_name, lower(p_email), 'entity', 'active', true)
    RETURNING identity_id INTO v_id;
    IF to_regclass('public.platform_root') IS NOT NULL THEN
      UPDATE identities SET
        governed_by          = (SELECT root_id FROM platform_root LIMIT 1),
        constitution_version = (SELECT version FROM platform_constitution WHERE is_active LIMIT 1),
        plan                 = 'enterprise'
      WHERE identity_id = v_id AND governed_by IS NULL;
    END IF;
  END IF;

  SELECT schema_id INTO v_schema FROM entity_schemas
   WHERE entity_id = v_id AND schema_name = v_sname AND is_default = true LIMIT 1;
  IF v_schema IS NULL THEN
    INSERT INTO entity_schemas (entity_id, schema_name, schema_type, source, status, is_default)
    VALUES (v_id, v_sname, v_stype, 'template', 'active', true) RETURNING schema_id INTO v_schema;
    FOR f IN SELECT * FROM jsonb_array_elements(coalesce(p_pack->'fields', '[]'::jsonb)) LOOP
      INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, display_order)
      VALUES (v_schema, f->>'name', f->>'key', coalesce(f->>'type','text'),
              coalesce((f->>'required')::boolean, false), coalesce((f->>'order')::int, 0));
    END LOOP;
  END IF;

  RETURN v_id;
END $fn$;

-- 4) Mint by registered blueprint key.
CREATE OR REPLACE FUNCTION create_from_blueprint_key(p_name text, p_email text, p_key text)
RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_pack jsonb;
BEGIN
  SELECT pack INTO v_pack FROM blueprints WHERE blueprint_key = p_key AND active;
  IF v_pack IS NULL THEN RAISE EXCEPTION 'unknown or inactive blueprint: %', p_key; END IF;
  RETURN create_from_blueprint(p_name, p_email, v_pack);
END $fn$;

-- 5) create_helpdesk / is_helpdesk are now THIN WRAPPERS over the unified path (same signatures -> backward compatible).
CREATE OR REPLACE FUNCTION create_helpdesk(p_name text, p_email text)
RETURNS uuid LANGUAGE sql AS $$ SELECT create_from_blueprint_key(p_name, p_email, 'helpdesk'); $$;

CREATE OR REPLACE FUNCTION is_helpdesk(p_entity uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT is_instance_of(p_entity, 'Assistant Q&A'); $$;

COMMIT;

-- Sanity:
-- SELECT is_helpdesk((SELECT identity_id FROM identities WHERE email='help@chitbridge.system'));  -- true
-- Register + mint a second, dissimilar blueprint (example only — real packs come from the vertical-pack model):
-- INSERT INTO blueprints (blueprint_key,label,pack) VALUES ('gallery','Art Gallery',
--   '{"schema_name":"Artwork","schema_type":"general","fields":[
--     {"name":"Title","key":"title","type":"text","required":true,"order":1},
--     {"name":"Artist","key":"artist","type":"text","required":true,"order":2},
--     {"name":"Medium","key":"medium","type":"text","required":false,"order":3},
--     {"name":"Provenance","key":"provenance","type":"text","required":false,"order":4},
--     {"name":"Price","key":"price","type":"number","required":false,"order":5}]}'::jsonb)
--   ON CONFLICT (blueprint_key) DO UPDATE SET pack=EXCLUDED.pack;
-- SELECT create_from_blueprint_key('Demo Gallery','gallery@demo.helpdesk','gallery');

-- migration_b55_connector_blueprint_and_capabilities.sql
-- W2 (blueprint operationalization) — two things at once, both DATA-driven over the unified mint path (b47):
--   1) DIVERSITY PROOF (reviewer #5): register a SECOND, dissimilar blueprint — Connector / IoT Device — and mint
--      it through the SAME create_from_blueprint path. Its shape (telemetry) is nothing like Helpdesk (Q&A) or
--      an order (product), so a clean mint proves "swap to a stranger's vertical and it reshapes."
--   2) CAPABILITY SELECTION (the itemised-toggle model): a blueprint carries a DEFAULT capability selection, and
--      minting STAMPS it onto the entity. CORE capabilities are always-on (implicit); the pack's `capabilities`
--      array = the ADD-ONs this blueprint turns on. Helpdesk = a full service desk (dispute/assign/curate);
--      Connector/IoT = pure transfer, NO add-ons ([]) — the leaner selection, exactly the contrast we want.
--
-- Scope of the selection stored here = the ENTITY tier (the "checkboxes"), capped later by the PLAN ceiling and
-- narrowed at render by the HAT. This migration only STAMPS the default; the toggle UI + backend entitlement
-- enforcement + render/lazy-load gating come next (piloted on `dispute`). Idempotent / re-runnable. Run in Supabase.

BEGIN;

-- 1) The entity's capability selection = governed config on the entity. NULL = not yet stamped (render treats as
--    core-only). Stamped by the blueprint at mint; never clobbered once set (an entity may have toggled its own).
ALTER TABLE identities ADD COLUMN IF NOT EXISTS capabilities jsonb;

-- 2) Extend the HELPDESK pack with its default add-on selection (packs are data — just set a key).
UPDATE blueprints
   SET pack = jsonb_set(pack, '{capabilities}', '["dispute","assign","curate"]'::jsonb),
       updated_at = now()
 WHERE blueprint_key = 'helpdesk';

-- 3) Register the CONNECTOR / IoT blueprint — a dissimilar, minimal telemetry shape + an EMPTY add-on set
--    (pure transfer: a device just emits signals; no human workflow capabilities).
INSERT INTO blueprints (blueprint_key, label, pack) VALUES ('connector', 'Connector / IoT Device',
  $pack${
    "schema_name":"Device Signal","schema_type":"custom",
    "capabilities":[],
    "fields":[
      {"name":"Device ID","key":"device_id","type":"text","required":true,"order":1},
      {"name":"Signal","key":"signal","type":"text","required":true,"order":2},
      {"name":"Value","key":"value","type":"number","required":false,"order":3},
      {"name":"Unit","key":"unit","type":"text","required":false,"order":4},
      {"name":"Observed At","key":"observed_at","type":"text","required":false,"order":5}
    ]}$pack$::jsonb)
ON CONFLICT (blueprint_key) DO UPDATE SET label=EXCLUDED.label, pack=EXCLUDED.pack, updated_at=now();

-- 4) Redefine THE mint path to also STAMP the entity's capability selection from the pack (only if unset).
--    Everything else identical to b47 — this is additive.
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

  -- NEW: stamp the capability SELECTION from the pack (add-ons; core is implicit). Only if unset — never clobber.
  UPDATE identities SET capabilities = coalesce(p_pack->'capabilities', '[]'::jsonb)
   WHERE identity_id = v_id AND capabilities IS NULL;

  RETURN v_id;
END $fn$;

-- 5) Backfill existing helpdesk entities (e.g. GOV-01-Help) with the helpdesk default selection, so the contrast
--    is visible immediately. Only where unset — idempotent.
UPDATE identities SET capabilities = '["dispute","assign","curate"]'::jsonb
 WHERE capabilities IS NULL AND is_instance_of(identity_id, 'Assistant Q&A');

COMMIT;

-- ── PROOF (run these after COMMIT) ─────────────────────────────────────────────
-- a) Mint a Connector/IoT instance through the SAME path that mints a helpdesk:
--    SELECT create_from_blueprint_key('Edge Gateway 01', 'gw01@connector.iot', 'connector');
--
-- b) It reshaped: a 'Device Signal' entity with telemetry fields + an EMPTY capability selection (pure transfer):
--    SELECT display_name,
--           is_instance_of(identity_id, 'Device Signal') AS is_connector,
--           capabilities
--      FROM identities WHERE email = 'gw01@connector.iot';
--    -- expect: is_connector = true, capabilities = []
--
-- c) Its schema fields came from the pack (device_id/signal/value/unit/observed_at):
--    SELECT sf.field_name, sf.field_key, sf.field_type, sf.required
--      FROM entity_schemas es JOIN schema_fields sf ON sf.schema_id = es.schema_id
--     WHERE es.entity_id = (SELECT identity_id FROM identities WHERE email='gw01@connector.iot')
--     ORDER BY sf.display_order;
--
-- d) Contrast: the helpdesk carries the RICHER selection (dispute/assign/curate):
--    SELECT display_name, capabilities FROM identities WHERE email = 'help@chitbridge.system';
--    -- expect: capabilities = ["dispute","assign","curate"]
--
-- Same mint path, one INSERT of a data pack, two utterly different governed entities. That is the diversity proof.

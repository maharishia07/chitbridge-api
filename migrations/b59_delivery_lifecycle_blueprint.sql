-- b59_delivery_lifecycle_blueprint.sql — dogfood our SDLC as a mintable blueprint (SPEC-delivery-lifecycle.md).
-- Two additive things over the unified mint path (b47/b55):
--   1) extend create_from_blueprint to ALSO seed `options` + `placeholder` (so dropdown fields are real);
--   2) register the `delivery-lifecycle` blueprint — a Delivery Record schema encoding BR/SR/FR/Test/Impl +
--      maturity (CMMI) + foundations + security + verification level + lifecycle phase.
-- Idempotent / re-runnable. Apply AFTER 000_baseline (and after b57 if you want it alongside the connector).

BEGIN;

-- 1) Additive mint-path upgrade: carry options + placeholder from the pack. Backward-compatible — packs without
--    those keys insert NULL (identical to before). Everything else is unchanged from the b55 definition.
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
      INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, display_order, options, placeholder)
      VALUES (v_schema, f->>'name', f->>'key', coalesce(f->>'type','text'),
              coalesce((f->>'required')::boolean, false), coalesce((f->>'order')::int, 0),
              f->'options', f->>'placeholder');   -- NEW: options (jsonb) + placeholder (text); NULL when absent
    END LOOP;
  END IF;

  UPDATE identities SET capabilities = coalesce(p_pack->'capabilities', '[]'::jsonb)
   WHERE identity_id = v_id AND capabilities IS NULL;

  RETURN v_id;
END $fn$;

-- 2) Register the delivery-lifecycle blueprint (data pack). Dropdowns carry options; add-on capabilities = [].
INSERT INTO blueprints (blueprint_key, label, pack) VALUES ('delivery-lifecycle', 'Product / Capability Delivery Lifecycle',
  $pack${
    "schema_name":"Delivery Record","schema_type":"custom",
    "capabilities":[],
    "fields":[
      {"name":"Business Requirement","key":"br","type":"text","required":true,"order":1,"placeholder":"Why — the business outcome"},
      {"name":"System / Non-functional Requirement","key":"sr","type":"text","required":false,"order":2,"placeholder":"Isolation, rail, platform-independence, retention"},
      {"name":"Functional Requirements","key":"fr","type":"text","required":false,"order":3,"placeholder":"The behaviours (FR-x)"},
      {"name":"Test / Acceptance Cases","key":"tests","type":"text","required":false,"order":4,"placeholder":"How each FR is proven — written BEFORE build"},
      {"name":"Implementation Standard","key":"impl","type":"text","required":false,"order":5,"placeholder":"Which disciplines apply"},
      {"name":"Maturity Level","key":"maturity","type":"dropdown","required":false,"order":6,
        "options":["L1 Proven","L2 Packaged","L3 Itemised","L4 Governed","L5 Productized"]},
      {"name":"Foundations Covered","key":"foundations","type":"checkbox","required":false,"order":7,
        "options":["RLS / Isolation","Rail","Auth","Dispute","Governance"]},
      {"name":"Security Posture","key":"security","type":"text","required":false,"order":8,"placeholder":"transit · at-rest · secrets"},
      {"name":"Verification Level","key":"verification","type":"dropdown","required":false,"order":9,
        "options":["Parse","Boot","Read","Human-run"]},
      {"name":"Lifecycle Phase","key":"phase","type":"dropdown","required":false,"order":10,
        "options":["Elicit","Specify","Design","Build","Verify","Release","Operate"]}
    ]}$pack$::jsonb)
ON CONFLICT (blueprint_key) DO UPDATE SET label=EXCLUDED.label, pack=EXCLUDED.pack, updated_at=now();

COMMIT;

-- ── PROOF (run after COMMIT) ───────────────────────────────────────────────────
-- R1) mint a Delivery Record for a real capability:
--     SELECT create_from_blueprint_key('Connector L3.1','del-connector@delivery.local','delivery-lifecycle');
-- R2/R3) it reshaped + dropdowns carry options:
--     SELECT sf.display_order, sf.field_name, sf.field_type, sf.options
--       FROM entity_schemas es JOIN schema_fields sf ON sf.schema_id=es.schema_id
--      WHERE es.entity_id=(SELECT identity_id FROM identities WHERE email='del-connector@delivery.local')
--      ORDER BY sf.display_order;      -- expect 10 rows; maturity/verification/phase show options arrays
-- R5) capability selection stamped []:
--     SELECT capabilities FROM identities WHERE email='del-connector@delivery.local';   -- expect []
-- R4) backward-compat: existing packs still mint (connector has no options → NULL, unchanged):
--     SELECT create_from_blueprint_key('Edge GW test','gw-compat@connector.iot','connector');  -- should succeed

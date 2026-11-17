-- migration_b46_helpdesk_blueprint.sql — templatize the helpdesk into a reusable BLUEPRINT.
-- Two functions:
--   is_helpdesk(entity)      -> true if the entity carries the helpdesk signature (an active 'Assistant Q&A' schema).
--   create_helpdesk(name,email) -> mints a NEW helpdesk entity (sealed, governed if gov01 applied) + its Q&A schema
--                                  + fields, idempotent by email; returns the entity_id.
-- GOV-01-Help is already a helpdesk (it has that schema), so is_helpdesk(GOV-01-Help)=true — backward compatible.
-- Instantiate another desk:   SELECT create_helpdesk('Acme Support', 'support@acme.helpdesk');
-- Run in Supabase SQL editor. Idempotent / re-runnable.

BEGIN;

CREATE OR REPLACE FUNCTION is_helpdesk(p_entity uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM entity_schemas
     WHERE entity_id = p_entity AND schema_name = 'Assistant Q&A' AND status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION create_helpdesk(p_name text, p_email text)
RETURNS uuid LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid; v_schema uuid;
BEGIN
  -- 1) entity (idempotent by email); sealed source entity
  SELECT identity_id INTO v_id FROM identities WHERE email = lower(p_email);
  IF v_id IS NULL THEN
    INSERT INTO identities (bridge_id, display_name, email, identity_type, status, sealed)
    VALUES ('HD' || upper(substr(md5(random()::text), 1, 8)), p_name, lower(p_email), 'entity', 'active', true)
    RETURNING identity_id INTO v_id;
    -- stamp governance if the protected root exists (gov01 applied)
    IF to_regclass('public.platform_root') IS NOT NULL THEN
      UPDATE identities SET
        governed_by          = (SELECT root_id FROM platform_root LIMIT 1),
        constitution_version = (SELECT version FROM platform_constitution WHERE is_active LIMIT 1),
        plan                 = 'enterprise'
      WHERE identity_id = v_id AND governed_by IS NULL;
    END IF;
  END IF;

  -- 2) Q&A schema (idempotent) + fields
  SELECT schema_id INTO v_schema FROM entity_schemas
   WHERE entity_id = v_id AND schema_name = 'Assistant Q&A' AND is_default = true LIMIT 1;
  IF v_schema IS NULL THEN
    INSERT INTO entity_schemas (entity_id, schema_name, schema_type, source, status, is_default)
    VALUES (v_id, 'Assistant Q&A', 'custom', 'template', 'active', true)
    RETURNING schema_id INTO v_schema;
    INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, display_order)
    SELECT v_schema, x.fn, x.fk, 'text', x.rq, x.ord FROM (VALUES
      ('Question','question',true,1),('Answer','answer',true,2),('Context','context',false,3),
      ('Topics','topics',false,4),('Fit','fit',false,5),('Media','media',false,6)
    ) AS x(fn,fk,rq,ord);
  END IF;

  RETURN v_id;
END $fn$;

COMMIT;

-- Sanity:
-- SELECT is_helpdesk((SELECT identity_id FROM identities WHERE email='help@chitbridge.system'));   -- expect true
-- SELECT create_helpdesk('Demo Desk','demo@desk.helpdesk');                                        -- mints a 2nd helpdesk

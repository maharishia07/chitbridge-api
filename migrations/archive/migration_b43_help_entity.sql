-- migration_b43_help_entity.sql — provision the PROTECTED Help entity + its Q&A schema + lift the 52 into its catalogue.
-- The assistant knowledge now lives on our OWN engine: a governed/protected entity (under platform_root + active
-- constitution) -> schema (entity_schemas/schema_fields) -> catalogue (catalogue_items.item_data), BUILT FROM the
-- existing assist_qa rows. assist_qa stays the PUBLIC SERVING projection. Idempotent; this repo file backs up the source.
-- Requires: migration_b42_assist_qa applied (source rows). Safe if gov01 is NOT applied (governance stamping is skipped).
-- Run in the Supabase SQL editor.

BEGIN;

-- 0) Protect the source. FK-restrict already blocks deleting the entity while its items exist; sealed=true is the
--    app-level marker (delete flows must refuse it). The real backup is this version-controlled file (idempotent re-run).
ALTER TABLE identities ADD COLUMN IF NOT EXISTS sealed boolean NOT NULL DEFAULT false;

-- 1) The Help entity (base columns). Idempotent by email.
INSERT INTO identities (bridge_id, display_name, email, identity_type, status, sealed)
SELECT 'CBHELPSRC01', 'Chit & Bridge Help', 'help@chitbridge.system', 'entity', 'active', true
WHERE NOT EXISTS (SELECT 1 FROM identities WHERE email = 'help@chitbridge.system');

-- 1b) Stamp governance ONLY if the protected root exists (=> gov01 applied => its columns exist too). Skipped otherwise.
DO $do$
BEGIN
  IF to_regclass('public.platform_root') IS NOT NULL THEN
    UPDATE identities SET
      governed_by          = (SELECT root_id FROM platform_root LIMIT 1),
      constitution_version = (SELECT version FROM platform_constitution WHERE is_active LIMIT 1),
      plan                 = 'enterprise'
    WHERE email = 'help@chitbridge.system' AND governed_by IS NULL;
  END IF;
END $do$;

-- 2) Its Q&A schema (custom type; source=template — it seeds every entity as help). Idempotent.
INSERT INTO entity_schemas (entity_id, schema_name, schema_type, source, status, is_default)
SELECT (SELECT identity_id FROM identities WHERE email = 'help@chitbridge.system'),
       'Assistant Q&A', 'custom', 'template', 'active', true
WHERE NOT EXISTS (
  SELECT 1 FROM entity_schemas
  WHERE entity_id = (SELECT identity_id FROM identities WHERE email = 'help@chitbridge.system'));

-- 3) Schema fields (all text; arrays/objects ride in item_data JSONB). Idempotent.
INSERT INTO schema_fields (schema_id, field_name, field_key, field_type, required, display_order)
SELECT s.schema_id, v.field_name, v.field_key, 'text', v.required, v.display_order
FROM (SELECT schema_id FROM entity_schemas
      WHERE entity_id = (SELECT identity_id FROM identities WHERE email = 'help@chitbridge.system')
        AND is_default = true LIMIT 1) s,
     (VALUES ('Question','question',true,1),('Answer','answer',true,2),('Context','context',false,3),
             ('Topics','topics',false,4),('Fit','fit',false,5),('Media','media',false,6))
       AS v(field_name, field_key, required, display_order)
WHERE NOT EXISTS (SELECT 1 FROM schema_fields sf WHERE sf.schema_id = s.schema_id);

-- 4) Lift the 52 assist_qa rows into the Help catalogue (item_data.qa_id maps back to the projection).
--    Built directly from assist_qa (already seeded by b42) — no transcription. Idempotent per qa_id.
INSERT INTO catalogue_items (entity_id, schema_id, item_data)
SELECT (SELECT identity_id FROM identities WHERE email = 'help@chitbridge.system'),
       (SELECT schema_id FROM entity_schemas
          WHERE entity_id = (SELECT identity_id FROM identities WHERE email = 'help@chitbridge.system')
            AND is_default = true LIMIT 1),
       jsonb_build_object(
         'qa_id',    a.id,
         'question', a.question,
         'answer',   a.answer,
         'context',  to_jsonb(a.context),
         'topics',   to_jsonb(a.topics),
         'fit',      a.fit,
         'media',    a.media
       )
FROM assist_qa a
WHERE a.active = true
  AND NOT EXISTS (
    SELECT 1 FROM catalogue_items ci
    WHERE ci.entity_id = (SELECT identity_id FROM identities WHERE email = 'help@chitbridge.system')
      AND ci.item_data->>'qa_id' = a.id);

COMMIT;

-- verify count : SELECT count(*) FROM catalogue_items WHERE entity_id = (SELECT identity_id FROM identities WHERE email='help@chitbridge.system');  -- expect 52
-- verify entity: SELECT display_name, sealed, governed_by, constitution_version, plan FROM identities WHERE email='help@chitbridge.system';

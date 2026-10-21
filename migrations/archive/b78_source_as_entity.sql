-- b78: SOURCE-AS-ENTITY + EXPERIENCE BLUEPRINT (see C:\dev\SPEC-source-governed-distribution.md).
-- A catalogue_source is now OWNED by a brand ENTITY (owner_entity_id) and carries the CUSTOMER-EXPERIENCE blueprint
-- (experience) + formatting that CASCADE with the catalogue to every distributor. Additive, IF NOT EXISTS.
-- catalogue_source stays WITHOUT RLS (shared reference, read by all); WRITES are gated app-side by owner_entity_id
-- (only the owner brand may author its own source), so cb_app gets INSERT/UPDATE.

ALTER TABLE catalogue_source ADD COLUMN IF NOT EXISTS owner_entity_id uuid;
ALTER TABLE catalogue_source ADD COLUMN IF NOT EXISTS experience jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE catalogue_source ADD COLUMN IF NOT EXISTS formatting jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='cb_app') THEN
  EXECUTE 'GRANT SELECT,INSERT,UPDATE ON catalogue_source TO cb_app';
END IF; END $$;

-- Seed an experience blueprint on the existing source so the cascade is demonstrable immediately.
UPDATE catalogue_source SET
  experience = '{"visualize":{"enabled":true,"label":"Scan your home","effect":"wall-recolor","max_renders":5},
                "detail":{"live_combination_swap":true,"show_story":true,"show_application":true},
                "rules":{"min_order_litres":1,"order_routing":"nearest_distributor"}}'::jsonb,
  formatting = '{"accent":"#6a44a8","layout":"gallery","swatch":"round"}'::jsonb
WHERE source_key = 'beta-royale-play@v1'
  AND (experience IS NULL OR experience = '{}'::jsonb);

-- Rollback (optional): ALTER TABLE catalogue_source DROP COLUMN IF EXISTS owner_entity_id, DROP COLUMN IF EXISTS experience, DROP COLUMN IF EXISTS formatting;

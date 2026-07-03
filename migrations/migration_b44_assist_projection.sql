-- migration_b44_assist_projection.sql — projection sync: Help CATALOGUE (source of truth) -> assist_qa (serving).
-- Any catalogue_item whose item_data carries a 'qa_id' is a Help Q&A record. This trigger projects it onto assist_qa
-- on every INSERT/UPDATE/DELETE, so editing the CATALOGUE updates the live assistant — no app change, no redeploy.
-- is_active drives served/not-served (a draft catalogue item => assist_qa.active=false => not served).
-- Idempotent (CREATE OR REPLACE fn + DROP/CREATE trigger). Requires b42 (assist_qa) + b43 (catalogue). Run in Supabase.

BEGIN;

CREATE OR REPLACE FUNCTION assist_project_from_catalogue()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE
  d   jsonb;
  ctx text[];
  tpc text[];
BEGIN
  -- Removal: a deleted Help item is de-served (kept in assist_qa for history, just inactive).
  IF TG_OP = 'DELETE' THEN
    IF (OLD.item_data ? 'qa_id') THEN
      UPDATE assist_qa SET active = false, updated_at = now()
      WHERE id = OLD.item_data->>'qa_id';
    END IF;
    RETURN OLD;
  END IF;

  d := NEW.item_data;
  IF NOT (d ? 'qa_id') THEN
    RETURN NEW;                    -- not a Help Q&A item (e.g. a product) — ignore
  END IF;

  ctx := CASE WHEN jsonb_typeof(d->'context') = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(d->'context')) ELSE '{}'::text[] END;
  tpc := CASE WHEN jsonb_typeof(d->'topics') = 'array'
              THEN ARRAY(SELECT jsonb_array_elements_text(d->'topics')) ELSE '{}'::text[] END;

  INSERT INTO assist_qa (id, context, topics, question, answer, fit, media, sort, active, updated_at)
  VALUES (
    d->>'qa_id', ctx, tpc, d->>'question', d->>'answer',
    NULLIF(d->>'fit',''),
    CASE WHEN jsonb_typeof(d->'media') = 'object' THEN d->'media' ELSE NULL END,
    COALESCE((SELECT sort FROM assist_qa WHERE id = d->>'qa_id'), 1000),
    COALESCE(NEW.is_active, true),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    context  = EXCLUDED.context, topics = EXCLUDED.topics,
    question = EXCLUDED.question, answer = EXCLUDED.answer,
    fit      = EXCLUDED.fit,     media  = EXCLUDED.media,
    active   = EXCLUDED.active,  updated_at = now();

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_assist_project ON catalogue_items;
CREATE TRIGGER trg_assist_project
  AFTER INSERT OR UPDATE OR DELETE ON catalogue_items
  FOR EACH ROW EXECUTE FUNCTION assist_project_from_catalogue();

COMMIT;

-- ── Prove it (safe, reversible) ─────────────────────────────────────────────
-- 1) Edit an answer in the CATALOGUE:
--   UPDATE catalogue_items SET item_data = jsonb_set(item_data,'{answer}','"Projection test — edited in the catalogue."')
--   WHERE item_data->>'qa_id'='coassist'
--     AND entity_id=(SELECT identity_id FROM identities WHERE email='help@chitbridge.system');
-- 2) See it appear in the serving projection immediately:
--   SELECT id, answer, updated_at FROM assist_qa WHERE id='coassist';
-- 3) (then GET /api/assist/questions?context=coassists shows the new answer — no redeploy)
-- 4) Revert:
--   UPDATE catalogue_items SET item_data = jsonb_set(item_data,'{answer}','"Anyone — or anything — that acts for you. People now; connectors, devices, process rules and AI agents next. You stay the party; they act for you within your entity''s scope (per-actor limits are coming)."')
--   WHERE item_data->>'qa_id'='coassist'
--     AND entity_id=(SELECT identity_id FROM identities WHERE email='help@chitbridge.system');

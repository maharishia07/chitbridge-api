-- migration_b53_assist_residency_qa.sql — seed a curated assistant Q&A about DATA RESIDENCY.
-- Purpose (Athi 2026-07-04): put the residency capability on record in the assistant, so we know about it and it can
-- be enabled if an installation demands it. Follows the established pattern (b43/publish): insert a catalogue_item
-- under the Help entity; the b44 projection trigger serves it live via assist_qa. Idempotent (delete-then-insert by
-- qa_id). Run as postgres. Design detail lives in docs/DATA-RESIDENCY-DESIGN.md.
--
-- SECURITY-GIST DISCIPLINE (Athi): the answer gives the OUTCOME + assurance, never the architecture (no RLS/definer/
-- role/engine internals — those are attack surface). CATEGORY discipline: item_data.category = 'governance'. NOTE:
-- the `category` field rides in item_data now (forward-compatible); the projection/serving of `category` (an
-- assist_qa.category column + surfacing in GET /api/assist/questions) is a later additive step.

BEGIN;

-- idempotency: clear any prior copy of this curated Q&A under the Help entity
DELETE FROM catalogue_items ci
 USING identities i
 WHERE ci.entity_id = i.identity_id
   AND i.email = 'help@chitbridge.system'
   AND ci.item_data->>'qa_id' = 'gov_data_residency';

-- insert under the Help entity + its default schema (resolved by the stable install email)
INSERT INTO catalogue_items (entity_id, schema_id, item_data, is_active)
SELECT
  i.identity_id,
  (SELECT es.schema_id FROM entity_schemas es
     WHERE es.entity_id = i.identity_id AND es.is_default = true
     ORDER BY es.created_at DESC LIMIT 1),
  jsonb_build_object(
    'qa_id',   'gov_data_residency',
    'question','Can my business''s data be kept in my own region or country (data residency)?',
    'answer',  'Yes. Chit & Bridge can keep each business''s data in its own region or country. Because every party '
             ||'to a shared record holds its own separate copy, one business''s copy can be stored in Europe while '
             ||'another''s is stored in Asia — cleanly separated and kept where each business needs it. A whole '
             ||'deployment can also be homed to a single region. Regional data residency is available where an '
             ||'installation or regulation requires it — contact us to enable it for your deployment.',
    'context', jsonb_build_array('*', 'governance', 'security'),
    'topics',  jsonb_build_array('residency', 'data', 'region', 'compliance', 'gdpr', 'sovereignty'),
    'fit',     NULL,
    'media',   NULL,
    'status',  'approved',
    'category','governance'
  ),
  true
FROM identities i
WHERE i.email = 'help@chitbridge.system'
LIMIT 1;

COMMIT;

-- Verify (as postgres): the Q&A projected into the served layer.
--   SELECT question, active FROM assist_qa WHERE id = 'gov_data_residency';   -- (assist_qa.id maps from item_data.qa_id)
-- If nothing inserted, the Help entity/schema isn't provisioned yet — run b43/b45 first, then re-run this.

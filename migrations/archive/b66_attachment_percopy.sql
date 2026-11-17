-- b66: attachments become PER-ENTITY copies (mailing model). Each participant owns its OWN cb_attachment row, so
-- anyone can delete theirs without affecting others. Adds entity_id + RLS (identical predicate to b49/b64).
--
-- ⚠️ COUPLING RULE: enable ONLY after every cb_attachment access is on withEntity() — done in lib/storage.js
--    (put→replicate per participant, getBlob/listForChit/listForMessages/meta all entity-scoped).
-- Pre-b66 rows have entity_id NULL → invisible under RLS (fail-closed). They are legacy/disposable test data;
-- re-upload if any are still needed. Going forward every row is owned by exactly one entity.
--
-- Rollback: ALTER TABLE cb_attachment DISABLE ROW LEVEL SECURITY; DROP POLICY IF EXISTS rls_entity ON cb_attachment;

ALTER TABLE cb_attachment ADD COLUMN IF NOT EXISTS entity_id uuid;
CREATE INDEX IF NOT EXISTS cb_attachment_entity_chit_idx ON cb_attachment(entity_id, chit_id);
CREATE INDEX IF NOT EXISTS cb_attachment_entity_msg_idx  ON cb_attachment(entity_id, message_id);

ALTER TABLE cb_attachment ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_attachment FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON cb_attachment;
CREATE POLICY rls_entity ON cb_attachment
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

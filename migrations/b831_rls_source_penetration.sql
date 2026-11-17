-- b831_rls_source_penetration.sql — SEC-75 part 2, group C (29 Oct 2026): RLS on source_penetration, after its two call sites moved onto withEntity.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres), AFTER the api PR that moves the call sites is deployed
--    (routes/catalogue.js INSERT under withEntity(distributor) · routes/assist.js GET /penetration under withEntity(brand)). Safe to re-run. Touches no rows, no grants.
--    Run it BEFORE that deploy and the order-time insert and the brand heatmap fail closed (both are best-effort / 503), so deploy first.
--
-- WHY. source_penetration holds (source_key, distributor_entity_id, locality) per order: which distributor sold which brand's source, where. Open, any cb_app statement reads every brand's heatmap.
-- WHO MAY SEE A ROW (same key shape as b779, app.current_entity):
--   · the distributor that wrote it (distributor_entity_id = me), and
--   · the brand that owns the source (catalogue_source.owner_entity_id = me) — that is the heatmap the brand is meant to see.
-- WHO MAY WRITE: only as the distributor (WITH CHECK distributor_entity_id = me).
-- catalogue_source stays open on purpose (shared published reference, see the PR), so the EXISTS below reads it without a binding of its own.
-- NOT IN THIS FILE: catalogue_source, standard_source, product_container, product_version, resolved_blueprint, container_region_override — open by design, see the PR.
-- RLS: ENABLE + FORCE + policy rls_entity, written as literal statements (no format() loop, db-85 rule).

BEGIN;

ALTER TABLE source_penetration ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_penetration FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON source_penetration;
CREATE POLICY rls_entity ON source_penetration
  USING      (distributor_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid
              OR EXISTS (SELECT 1 FROM catalogue_source cs
                          WHERE cs.source_key = source_penetration.source_key
                            AND cs.owner_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid))
  WITH CHECK (distributor_entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

COMMIT;

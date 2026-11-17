-- b778_rls_governance_exceptions.sql — SEC-75 (23 Oct 2026): governance_exceptions holds ONE shop's rows and had RLS OFF in production.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres) AFTER the api that sets the shop on the new-shop insert is deployed
--    (routes/governance.js POST /: the exception rows are written under the new shop's own binding). Safe to re-run (DROP POLICY IF EXISTS,
--    then CREATE). Touches no rows.
--
-- WHY. The exceptions a shop was minted with (klass/key/detail, the "this shop differs from its constitution" list) are that shop's own
--    record; with RLS off any statement as cb_app could read every shop's. The only code that touches the table is the insert in
--    routes/governance.js (mint a customer shop); it now sets app.current_entity to the new shop inside the same transaction, which is the
--    house way when a request creates the shop it writes for (routes/catalogue.js:1632). No code reads the table; the policy therefore
--    changes no answer a shopkeeper sees.
-- RLS: ENABLE + FORCE + policy rls_entity, the b49/b270 shape (entity_id = app.current_entity, USING and WITH CHECK).
--    Privileges unchanged (cb_app keeps SELECT, INSERT, UPDATE, DELETE; add-only rule: nothing is revoked).

ALTER TABLE governance_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE governance_exceptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON governance_exceptions;
CREATE POLICY rls_entity ON governance_exceptions
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

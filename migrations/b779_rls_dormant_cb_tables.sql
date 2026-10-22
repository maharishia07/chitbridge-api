-- b779_rls_dormant_cb_tables.sql — SEC-75 (23 Oct 2026): six legacy cb_* tables that hold ONE shop's rows, read by NO code, RLS OFF in production.
--
-- ⚠️⚠️ DRAFT — NOT RUN · Athi runs it (Supabase SQL editor, AS postgres). Safe to re-run (DROP POLICY IF EXISTS, then CREATE). Touches no rows.
--
-- WHY. These came in with the old cb_* schema (legacy_id columns). git grep over the api finds no statement that reads or writes any of
--    them, and the web repo none, so closing them changes nothing a person sees; open, they let any cb_app statement read every shop's
--    devices, contacts, employees, supplier links and referral records. Each table has one owning-shop column, and the policy keys on it:
--      cb_device(entity_id) · cb_external_reference(entity_id) · cb_entity_supplier(entity_id)
--      cb_contact(owner_id) · cb_entity_employee(owner_id) · cb_consumer_traction(business_id)
--    (cb_contact.contact_id is the OTHER party; a row is the owner's, so the owner column is the key, the customer_list / supplier_list rule.)
-- RLS: ENABLE + FORCE + policy rls_entity, the b49/b270 shape (key = app.current_entity, USING and WITH CHECK). Privileges unchanged.
--    The first reader of one of these tables must go through withEntity (the RLS guard list in db/index.js gets the name then).

ALTER TABLE cb_device ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_device FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON cb_device;
CREATE POLICY rls_entity ON cb_device
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER TABLE cb_external_reference ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_external_reference FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON cb_external_reference;
CREATE POLICY rls_entity ON cb_external_reference
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER TABLE cb_entity_supplier ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_entity_supplier FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON cb_entity_supplier;
CREATE POLICY rls_entity ON cb_entity_supplier
  USING      (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (entity_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER TABLE cb_contact ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_contact FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON cb_contact;
CREATE POLICY rls_entity ON cb_contact
  USING      (owner_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER TABLE cb_entity_employee ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_entity_employee FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON cb_entity_employee;
CREATE POLICY rls_entity ON cb_entity_employee
  USING      (owner_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

ALTER TABLE cb_consumer_traction ENABLE ROW LEVEL SECURITY;
ALTER TABLE cb_consumer_traction FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rls_entity ON cb_consumer_traction;
CREATE POLICY rls_entity ON cb_consumer_traction
  USING      (business_id = NULLIF(current_setting('app.current_entity', true), '')::uuid)
  WITH CHECK (business_id = NULLIF(current_setting('app.current_entity', true), '')::uuid);

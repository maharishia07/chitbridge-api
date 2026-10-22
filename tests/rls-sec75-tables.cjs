'use strict';
/**
 * tests/rls-sec75-tables.cjs — the tables SEC-75 closes, and how a probe row for each is planted (the one list two tests read).
 * CARD 28-platform-and-operations/rls-census
 *
 * OWNS       for every table that has a `fix` in db/rls-baseline.json: its shop key column and the other NOT NULL columns a probe row needs.
 * CALLED BY  tests/rls-fresh-db.test.cjs (plants two shops' rows and reads them back as cb_app) · tests/rls-open-ratchet.test.cjs (a `fix` with no
 *            entry here has no proof, and fails offline)
 * FLOW       table → { key, cols } → INSERT INTO table (key, cols…) VALUES ($1, exprs…)
 */
module.exports = {
  governance_exceptions: { key: 'entity_id', cols: { klass: "'C'", detail: "'probe'" } },
  cb_device: { key: 'entity_id', cols: {} },
  cb_external_reference: { key: 'entity_id', cols: {} },
  cb_entity_supplier: { key: 'entity_id', cols: {} },
  cb_contact: { key: 'owner_id', cols: { contact_id: 'gen_random_uuid()' } },
  cb_entity_employee: { key: 'owner_id', cols: { employee_id: 'gen_random_uuid()' } },
  cb_consumer_traction: { key: 'business_id', cols: {} },
};

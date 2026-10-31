/**
 * kyb-scenes.cjs — the named scenarios of tests/api-problem-kyb.test.cjs: an answer the generic worlds cannot reach (a seeded panel to prove byte for byte, a refusal
 * inside a handler, a library that throws).
 *
 * OWNS      the extras: one scenario per answer of routes/kyb.js worth freezing, with the stand-in rows it needs; and the rows themselves (what the shop holds, what it traded).
 * CALLED BY tests/api-problem-kyb.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, db, jsonThrows }, patch, env, body, url, synthetic }] → the harness runs each one against the real route
 * CARD      qa/offline-guards
 * A scenario with `synthetic: true` makes a library throw an error that carries a status no real library raises under these routes: it is replayed in a capture and a compare
 * (the status pass-through is frozen), and checked on its own in a check run, where the contract declares no such status.
 */
'use strict';
const K = '/api/kyb';
const CHIT = '33333333-3333-4333-8333-333333333333';
const OTHER_CHIT = '66666666-6666-4666-8666-666666666666';
const DAY = 86400000;
/** a date a whole number of days ahead plus an hour, so the day count the panel prints does not move inside one test run */
const inDays = (days) => new Date(Date.now() + days * DAY + 3600000).toISOString();

/** the rows the readiness roll-up reads: three standards, their papers, and what the shop holds of them */
function heldRows() {
  const source = [{ standard_key: 'gst-registration' }, { standard_key: 'iec' }, { standard_key: 'fssai' }];
  const docs = [
    { standard_key: 'gst-registration', doc_key: 'gstn', title: 'GST registration', scope: 'org', frequency: 'once', display_order: 1 },
    { standard_key: 'iec', doc_key: 'certificate', title: 'Import Export Code', scope: 'org', frequency: 'once', display_order: 1 },
    { standard_key: 'fssai', doc_key: 'licence', title: 'FSSAI licence', scope: 'org', frequency: 'yearly', display_order: 1 }
  ];
  const gathered = [
    { standard_key: 'gst-registration', doc_key: 'gstn', status: 'gathered', evidence_ref: null, valid_until: null, verification: {} },
    { standard_key: 'iec', doc_key: 'certificate', status: 'gathered', evidence_ref: CHIT, valid_until: null, verification: {} },
    { standard_key: 'fssai', doc_key: 'licence', status: 'gathered', evidence_ref: null, valid_until: inDays(10), verification: {} }
  ];
  const standards = source.map((one) => Object.assign({ title: one.standard_key, applicability: {}, guidance: null }, one));
  return { source, docs, gathered, standards };
}
/** a stand-in that answers a statement with rows when the statement matches */
const when = (pattern, rows) => (sql) => (pattern.test(String(sql)) ? { rows, rowCount: rows.length } : null);
/** the first stand-in that has an answer wins */
const firstOf = (...answers) => (sql, params) => answers.map((answer) => answer(sql, params)).find((given) => given) || null;
/** the shop holds three papers: a bare claim, one with an owned evidence chit, one that runs out in ten days */
const heldPapers = () => {
  const held = heldRows();
  return firstOf(when(/FROM standard_source WHERE active = true AND COALESCE\(facet,''\) <> 'commerce' ORDER BY/, held.standards), when(/SELECT DISTINCT standard_key FROM standard_source/, held.source), when(/FROM standard_document/, held.docs), when(/FROM entity_compliance/, held.gathered));
};

/** what the shop traded: its own chit copies */
const tradeRows = (rows) => when(/FROM chit_header/, rows);
const sent = (to, value, currency) => ({ direction: 'sent', sender_entity_display_name: 'Test shop', all_recipients: [{ role: 'receiver', display_name: to }], total_value: value, currency_code: currency, purpose: 'order', created_at: '2026-10-01T00:00:00Z' });
const received = (from, value, currency) => ({ direction: 'received', sender_entity_display_name: from, all_recipients: [], total_value: value, currency_code: currency, purpose: 'order', created_at: '2026-10-02T00:00:00Z' });
const CONCENTRATED = [sent('Chola Traders', 700, 'INR'), sent('Chola Traders', 100, 'INR'), sent('Anand Stores', 150, 'INR'), received('Bharat Mills', 50, 'INR'), sent('Gulf Foods', 90, 'AED'), sent('Gulf Foods', null, 'AED'), { direction: 'sent', sender_entity_display_name: 'Test shop', all_recipients: [], total_value: null, currency_code: null, purpose: 'help', created_at: '2026-10-03T00:00:00Z' }];
const SPREAD = [sent('A', 30, 'INR'), sent('B', 25, 'INR'), sent('C', 25, 'INR'), sent('D', 20, 'INR')];
const MEDIUM = [sent('A', 45, 'INR'), sent('B', 30, 'INR'), sent('C', 25, 'INR')];

/** a lane matrix the position section computes from: closeable gaps (object and text), a structural one for EU and US, one lane with nothing missing */
const MATRIX = {
  lanes: [
    { dest_key: 'AE', dest_name: 'United Arab Emirates', percent: 100, met: 3, total: 3, gaps: [] },
    { dest_key: 'GB', dest_name: 'United Kingdom', percent: 66.66, met: 2, total: 3, gaps: [{ standard: 'ukca', title: 'UKCA mark' }] },
    { dest_key: 'JP', dest_name: 'Japan', summary: { percent: 33.3, met: 1, total: 3 }, missing: ['jfs', { standard: 'ukca', title: 'UKCA mark' }] },
    { dest_key: 'EU', dest_name: 'European Union', percent: 50, met: 1, total: 2, gaps: [{ standard: 'ce', title: 'CE marking' }] },
    { dest_key: 'US', dest_name: 'United States', percent: 0, met: 0, total: 1, gaps: [] }
  ]
};

/** an error that carries a SQL-looking sentence, and a status when asked */
const thrown = (secret, status) => async () => {
  throw Object.assign(new Error(secret), status ? { status } : {});
};

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const { SECRET_SQL, sqlError } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  /** an answer that exists only because a library is made to throw a status */
  const S = (id, route, expect, more) => X(id, route, expect, Object.assign({ synthetic: true }, more));
  const withRows = (answer) => ({ sqlRows: answer });
  const noWrite = (pattern, code) => (sql) => {
    if (pattern.test(String(sql))) throw sqlError(code);
    return null;
  };
  const YOURSELF = 'GET ' + K + '/yourself';
  const CREDENTIAL = 'POST ' + K + '/credential';
  const POSITION = 'GET ' + K + '/position';
  const RISK = 'GET ' + K + '/risk';
  const FIELD = 'POST ' + K + '/field';
  const cachedResult = { section: 'field', cached: false, charged: true, configured: true, results: [], reach: null, note: 'kept', wall: true };
  return [
    /* GET /yourself */
    X('yourself-held', YOURSELF, 200, { setup: withRows(heldPapers()) }),
    X('yourself-nothing-held', YOURSELF, 200, {}),
    X('yourself-reads-fail', YOURSELF, 200, { setup: { db: 'fail' } }),
    X('yourself-library-throws', YOURSELF, 500, { patch: { kyb: { yourself: thrown(SECRET_SQL) } } }),
    X('yourself-bad-setting', YOURSELF, 500, { env: { KYB_STRUCTURAL: '{ not json' } }),
    X('yourself-answer-fails', YOURSELF, 500, { setup: { jsonThrows: true } }),
    S('yourself-library-throws-409', YOURSELF, 409, { patch: { kyb: { yourself: thrown(SECRET_SQL, 409) } } }),
    S('yourself-library-throws-503', YOURSELF, 503, { patch: { kyb: { yourself: thrown(SECRET_SQL, 503) } } }),
    /* POST /credential */
    X('credential-by-title', CREDENTIAL, 200, { body: { title: 'Village NOC' } }),
    X('credential-by-standard', CREDENTIAL, 200, { body: { standard_key: 'iec', doc_key: 'certificate', evidence_ref: CHIT, valid_until: '2027-01-31' }, setup: withRows(when(/FROM chit_status/, [{ '?column?': 1 }])) }),
    X('credential-evidence-unknown', CREDENTIAL, 200, { body: { standard_key: 'iec', evidence_ref: OTHER_CHIT } }),
    X('credential-title-long', CREDENTIAL, 200, { body: { title: 'Municipal Licence To Trade In Dry Goods And Groceries Within The Ward Number Seven Area' } }),
    X('credential-title-an-object', CREDENTIAL, 400, { body: { title: { a: 1 } } }),
    X('credential-extra-keys', CREDENTIAL, 200, { body: { title: 'Village NOC', rung: 'verified', entity_id: 'x', verification: { method: 'registry' } } }),
    X('credential-nothing-named', CREDENTIAL, 400, { body: {} }),
    X('credential-body-a-list', CREDENTIAL, 400, { body: [] }),
    X('credential-title-blank', CREDENTIAL, 400, { body: { title: '', standard_key: '' } }),
    X('credential-db-fails', CREDENTIAL, 500, { body: { title: 'Village NOC' }, setup: { db: 'fail' } }),
    X('credential-bad-date', CREDENTIAL, 400, { body: { title: 'Village NOC', valid_until: 'next spring' }, setup: withRows(noWrite(/INSERT INTO entity_compliance/, '22007')) }),
    X('credential-library-throws', CREDENTIAL, 500, { body: { title: 'x' }, patch: { kyb: { addCredential: thrown(SECRET_SQL) } } }),
    X('credential-answer-fails', CREDENTIAL, 500, { body: { title: 'Village NOC' }, setup: { jsonThrows: true } }),
    S('credential-library-says-403', CREDENTIAL, 403, { says: 'Not for you.', body: { title: 'x' }, patch: { kyb: { addCredential: thrown('Not for you.', 403) } } }),
    S('credential-library-says-409', CREDENTIAL, 409, { says: 'Already held.', body: { title: 'x' }, patch: { kyb: { addCredential: thrown('Already held.', 409) } } }),
    S('credential-library-throws-503', CREDENTIAL, 503, { body: { title: 'x' }, patch: { kyb: { addCredential: thrown(SECRET_SQL, 503) } } }),
    /* GET /position */
    X('position-lanes', POSITION, 200, { patch: { readiness: { resolveLaneMatrix: async () => MATRIX } } }),
    X('position-lanes-asked', POSITION, 200, { url: K + '/position?vertical=paint&origin=IN', patch: { readiness: { resolveLaneMatrix: async (entity, vertical, origin) => ({ lanes: [{ dest_key: 'GB', dest_name: vertical + '/' + origin, percent: 10, met: 0, total: 1, gaps: [{ standard: 'ukca', title: 'UKCA mark' }] }] }) } } }),
    X('position-query-twice', POSITION, 200, { url: K + '/position?vertical=paint&vertical=food&origin=IN&origin=AE' }),
    X('position-nothing-stated', POSITION, 200, {}),
    X('position-lanes-fail', POSITION, 200, { patch: { readiness: { resolveLaneMatrix: thrown(SECRET_SQL) } } }),
    X('position-library-throws', POSITION, 500, { patch: { kyb: { position: thrown(SECRET_SQL) } } }),
    X('position-bad-setting', POSITION, 500, { env: { KYB_STRUCTURAL: '{ not json' } }),
    X('position-answer-fails', POSITION, 500, { setup: { jsonThrows: true } }),
    S('position-library-throws-409', POSITION, 409, { patch: { kyb: { position: thrown(SECRET_SQL, 409) } } }),
    /* GET /risk */
    X('risk-concentrated', RISK, 200, { setup: withRows(firstOf(tradeRows(CONCENTRATED), heldPapers())) }),
    X('risk-medium', RISK, 200, { setup: withRows(tradeRows(MEDIUM)) }),
    X('risk-spread', RISK, 200, { setup: withRows(tradeRows(SPREAD)) }),
    X('risk-expiring', RISK, 200, { setup: withRows(heldPapers()) }),
    X('risk-nothing-traded', RISK, 200, {}),
    X('risk-reads-fail', RISK, 200, { setup: { db: 'fail' } }),
    X('risk-library-throws', RISK, 500, { patch: { kyb: { risk: thrown(SECRET_SQL) } } }),
    X('risk-bad-setting', RISK, 500, { env: { KYB_STRUCTURAL: '{ not json', KYB_CONCENTRATION_PCT: '30' } }),
    X('risk-answer-fails', RISK, 500, { setup: { jsonThrows: true } }),
    S('risk-library-throws-503', RISK, 503, { patch: { kyb: { risk: thrown(SECRET_SQL, 503) } } }),
    /* POST /field */
    X('field-not-connected', FIELD, 200, {}),
    X('field-provider-named', FIELD, 200, { env: { KYB_FIELD_PROVIDER: 'x', KYB_FIELD_KEY: 'y' } }),
    X('field-served-from-cache', FIELD, 200, { setup: withRows(when(/FROM kyb_field_cache/, [{ result: cachedResult, created_at: '2026-10-01T00:00:00Z' }])) }),
    X('field-reads-fail', FIELD, 200, { setup: { db: 'fail' } }),
    X('field-library-throws', FIELD, 500, { patch: { kyb: { field: thrown(SECRET_SQL) } } }),
    X('field-bad-setting', FIELD, 500, { env: { KYB_STRUCTURAL: '{ not json' } }),
    X('field-answer-fails', FIELD, 500, { setup: { jsonThrows: true } }),
    S('field-library-throws-502', FIELD, 502, { patch: { kyb: { field: thrown(SECRET_SQL, 502) } } }),
    S('field-library-throws-409', FIELD, 409, { patch: { kyb: { field: thrown(SECRET_SQL, 409) } } })
  ];
}

module.exports = { extras, K, CHIT, OTHER_CHIT, heldPapers, firstOf, when, thrown, inDays };

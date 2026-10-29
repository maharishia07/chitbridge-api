/**
 * forms-scenes.cjs — the named scenarios of tests/api-problem-forms.test.cjs: an answer the generic worlds cannot reach (a seeded form to prove byte for byte, a refusal inside
 * a library, a form that is not ready, one already signed).
 *
 * OWNS      the extras: one scenario per answer of the eight routes of routes/forms.js worth freezing, with the stand-in rows it needs (answered by the shape of the
 *           statement, so the same facts meet the old and the new code), and the row of the foreign-id world (an issued form that belongs to one shop only).
 * CALLED BY tests/api-problem-forms.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db, jsonThrows }, patch, body, url, after }] → the harness runs each one against the real route
 * CARD      21-compliance-attestation-and-trade/functions/authority-forms
 * A scenario with `after: true` is an answer the sweep CHANGES on purpose (a body key the route never named is now refused, Q18): the base capture records what it answered
 * before (200), and the check run expects the new status.
 */
'use strict';
const F = '/api/forms';
const SHOP = '11111111-1111-4111-8111-111111111111';
const SHOP_B = '99999999-9999-4999-8999-999999999999';
const INSTANCE = '22222222-2222-4222-8222-222222222222';
const CHIT = '33333333-3333-4333-8333-333333333333';
const OTHER_CHIT = '66666666-6666-4666-8666-666666666666';
const FORM = 'authority-application';
const FULL = { applicant: 'Test shop', address: '1 High Street', signatory: 'R Kumar', purpose: 'Trade licence renewal' };

/** an issued form as the routes select it (every column any statement reads) */
const row = (more) =>
  Object.assign(
    {
      form_id: INSTANCE,
      entity_id: SHOP,
      form_key: FORM,
      context_ref: null,
      title: 'Application to an authority',
      fields: [
        { id: 'applicant', label: 'Applicant', value: 'Test shop', source: 'manual', rung: 'declared' },
        { id: 'purpose', label: 'Purpose', value: 'Trade licence renewal', source: 'manual', rung: 'declared' }
      ],
      provenance: { by_source: { manual: 2 } },
      content_hash: 'a'.repeat(64),
      ready: true,
      signed_at: null,
      signatory: null,
      transfers: [],
      created_at: '2026-10-01T00:00:00Z'
    },
    more
  );
/** a stand-in that answers a statement with rows when the statement matches */
const when = (pattern, rows) => (sql) => (pattern.test(String(sql)) ? { rows, rowCount: rows.length } : null);
/** the first stand-in that has an answer wins */
const firstOf = (...answers) => (sql, params) => answers.map((answer) => answer(sql, params)).find((given) => given) || null;
const withRows = (answer) => ({ sqlRows: answer });
const heldForm = (more) => withRows(when(/FROM form_instance WHERE entity_id = \$1 AND form_id = \$2/, [row(more)]));
const thrown = (secret, status) => async () => {
  throw Object.assign(new Error(secret), status ? { status } : {});
};

/**
 * the foreign-id world's rows: an issued form that belongs to shop A, answered to its owner only (as `WHERE entity_id = $1 AND form_id = $2` and row security would),
 * and a chit shop A holds. `planted: false` is the world where nothing exists for anyone (the unknown id).
 */
function universal(planted) {
  return (sql, params) => {
    const text = String(sql);
    const mine = params && params[0] === SHOP;
    if (/FROM form_instance WHERE entity_id = \$1 AND form_id = \$2/.test(text)) return planted && mine && params[1] === INSTANCE ? { rows: [row()], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (/FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2/.test(text)) return planted && params[1] === SHOP && params[0] === CHIT ? { rows: [{ all_recipients: [{ entity_id: SHOP, role: 'receiver' }] }], rowCount: 1 } : { rows: [], rowCount: 0 };
    if (/UPDATE form_instance SET signatory/.test(text)) return planted && mine ? { rows: [{ form_id: INSTANCE, signed_at: '2026-10-02T00:00:00Z', signatory: { name: 'R Kumar', designation: null } }], rowCount: 1 } : { rows: [], rowCount: 0 };
    return null;
  };
}

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const { SECRET_SQL, sqlError } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  /** an answer the sweep changes on purpose */
  const A = (id, route, expect, more) => X(id, route, expect, Object.assign({ after: true }, more));
  const raisingOn = (pattern, code) => (sql) => {
    if (pattern.test(String(sql))) throw sqlError(code);
    return null;
  };
  const LIST = 'GET ' + F;
  const ONE = 'GET ' + F + '/:key';
  const RESOLVE = 'POST ' + F + '/:key/resolve';
  const ISSUE = 'POST ' + F + '/:key/issue';
  const ALL = 'GET ' + F + '/instances/all';
  const INST = 'GET ' + F + '/instances/:id';
  const SIGN = 'POST ' + F + '/instances/:id/sign';
  const ATTACH = 'POST ' + F + '/instances/:id/attach';
  const at = (suffix) => F + suffix;
  const roster = withRows(firstOf(when(/FROM form_instance WHERE entity_id = \$1 AND form_id = \$2/, [row()]), when(/FROM chit_header WHERE chit_id = \$1 AND entity_id = \$2/, [{ all_recipients: [{ entity_id: SHOP, role: 'receiver' }] }])));
  const signable = withRows(firstOf(when(/UPDATE form_instance SET signatory/, [{ form_id: INSTANCE, signed_at: '2026-10-02T00:00:00Z', signatory: { name: 'R Kumar', designation: null } }]), when(/FROM form_instance WHERE entity_id = \$1 AND form_id = \$2/, [row()])));
  const filed = { storage: { putForParticipants: async () => 'att-0001' } };
  return [
    /* GET / */
    X('list-forms', LIST, 200, {}),
    X('list-forms-answer-fails', LIST, 500, { setup: { jsonThrows: true } }),
    X('list-forms-library-throws', LIST, 500, { patch: { forms: { listForms: () => { throw new Error(SECRET_SQL); } } } }),
    /* GET /:key */
    X('form-known', ONE, 200, { url: at('/' + FORM) }),
    X('form-known-certificate', ONE, 200, { url: at('/certificate-of-origin') }),
    X('form-unknown', ONE, 404, { url: at('/no-such-form') }),
    X('form-name-of-an-object', ONE, 200, { url: at('/constructor') }),
    X('form-name-proto', ONE, 200, { url: at('/__proto__') }),
    X('form-answer-fails', ONE, 500, { url: at('/' + FORM), setup: { jsonThrows: true } }),
    /* POST /:key/resolve */
    X('resolve-manual', RESOLVE, 200, { url: at('/' + FORM + '/resolve'), body: { manual: FULL } }),
    X('resolve-nothing-given', RESOLVE, 200, { url: at('/' + FORM + '/resolve'), body: {} }),
    X('resolve-body-a-list', RESOLVE, 200, { url: at('/' + FORM + '/resolve'), body: [] }),
    X('resolve-from-an-order', RESOLVE, 200, {
      url: at('/commercial-invoice/resolve'),
      body: { context_ref: CHIT },
      setup: withRows(when(/FROM chit_header WHERE entity_id = \$1 AND chit_id = \$2/, [{ subject: 'INV-7', sender_entity_display_name: 'Test shop', all_recipients: [{ role: 'receiver', display_name: 'Buyer Co', legal_name: 'Buyer Co' }], total_value: 1200, summary_json: { currency_code: 'INR', invoice_date: '2026-10-01' } }]))
    }),
    X('resolve-order-read-fails', RESOLVE, 200, { url: at('/' + FORM + '/resolve'), body: { context_ref: CHIT }, setup: { db: 'fail' } }),
    X('resolve-unknown-form', RESOLVE, 404, { url: at('/no-such-form/resolve'), body: {} }),
    X('resolve-name-of-an-object', RESOLVE, 500, { url: at('/constructor/resolve'), body: {} }),
    X('resolve-answer-fails', RESOLVE, 500, { url: at('/' + FORM + '/resolve'), body: {}, setup: { jsonThrows: true } }),
    X('resolve-library-throws', RESOLVE, 500, { url: at('/' + FORM + '/resolve'), body: {}, patch: { forms: { resolveForm: thrown(SECRET_SQL) } } }),
    X('resolve-library-says-409', RESOLVE, 409, { says: 'Clash.', url: at('/' + FORM + '/resolve'), body: {}, synthetic: true, patch: { forms: { resolveForm: thrown('Clash.', 409) } } }),
    A('resolve-unknown-key', RESOLVE, 422, { url: at('/' + FORM + '/resolve'), body: { manual: FULL, junk: 1 } }),
    /* POST /:key/issue */
    X('issue-ready', ISSUE, 200, { url: at('/' + FORM + '/issue'), body: { manual: FULL }, setup: withRows(when(/INSERT INTO form_instance/, [{ form_id: INSTANCE, created_at: '2026-10-01T00:00:00Z' }])) }),
    X('issue-not-ready', ISSUE, 400, { url: at('/' + FORM + '/issue'), body: {} }),
    X('issue-not-ready-body-a-list', ISSUE, 400, { url: at('/' + FORM + '/issue'), body: [] }),
    X('issue-unknown-form', ISSUE, 404, { url: at('/no-such-form/issue'), body: {} }),
    X('issue-store-missing', ISSUE, 503, { url: at('/' + FORM + '/issue'), body: { manual: FULL }, setup: withRows(raisingOn(/INSERT INTO form_instance/, '42P01')) }),
    X('issue-column-missing', ISSUE, 503, { url: at('/' + FORM + '/issue'), body: { manual: FULL }, setup: withRows(raisingOn(/INSERT INTO form_instance/, '42703')) }),
    X('issue-write-fails', ISSUE, 500, { url: at('/' + FORM + '/issue'), body: { manual: FULL }, setup: withRows(raisingOn(/INSERT INTO form_instance/, '22P02')) }),
    X('issue-db-fails-on-the-write', ISSUE, 500, { url: at('/' + FORM + '/issue'), body: { manual: FULL }, setup: withRows(raisingOn(/INSERT INTO form_instance/, '53300')) }),
    X('issue-answer-fails', ISSUE, 500, { url: at('/' + FORM + '/issue'), body: { manual: FULL }, setup: { jsonThrows: true, sqlRows: when(/INSERT INTO form_instance/, [{ form_id: INSTANCE, created_at: '2026-10-01T00:00:00Z' }]) } }),
    X('issue-library-throws', ISSUE, 500, { url: at('/' + FORM + '/issue'), body: {}, patch: { forms: { issueForm: thrown(SECRET_SQL) } } }),
    X('issue-library-says-409', ISSUE, 409, { says: 'Clash.', url: at('/' + FORM + '/issue'), body: {}, synthetic: true, patch: { forms: { issueForm: thrown('Clash.', 409) } } }),
    X('issue-library-throws-502', ISSUE, 502, { url: at('/' + FORM + '/issue'), body: {}, synthetic: true, patch: { forms: { issueForm: thrown(SECRET_SQL, 502) } } }),
    A('issue-unknown-key', ISSUE, 422, { url: at('/' + FORM + '/issue'), body: { manual: FULL, junk: 1 }, setup: withRows(when(/INSERT INTO form_instance/, [{ form_id: INSTANCE, created_at: '2026-10-01T00:00:00Z' }])) }),
    /* GET /instances/all */
    X('instances-listed', ALL, 200, { url: at('/instances/all'), setup: withRows(when(/FROM form_instance\s+WHERE entity_id = \$1 AND \(\$2::uuid IS NULL/, [row()])) }),
    X('instances-of-one-deal', ALL, 200, { url: at('/instances/all?context_ref=' + CHIT), setup: withRows(when(/FROM form_instance\s+WHERE entity_id = \$1 AND \(\$2::uuid IS NULL/, [row({ context_ref: CHIT })])) }),
    X('instances-none-yet', ALL, 200, { url: at('/instances/all') }),
    X('instances-store-missing', ALL, 200, { url: at('/instances/all'), setup: withRows(raisingOn(/FROM form_instance/, '42P01')) }),
    X('instances-bad-deal', ALL, 400, { url: at('/instances/all?context_ref=nope') }),
    X('instances-deal-asked-twice', ALL, 400, { url: at('/instances/all?context_ref=' + CHIT + '&context_ref=' + OTHER_CHIT) }),
    X('instances-deal-empty', ALL, 200, { url: at('/instances/all?context_ref=') }),
    X('instances-read-fails', ALL, 500, { url: at('/instances/all'), setup: withRows(raisingOn(/FROM form_instance/, '53300')) }),
    X('instances-answer-fails', ALL, 500, { url: at('/instances/all'), setup: { jsonThrows: true } }),
    X('instances-library-throws', ALL, 500, { url: at('/instances/all'), patch: { forms: { listInstances: thrown(SECRET_SQL) } } }),
    /* GET /instances/:id */
    X('instance-held', INST, 200, { url: at('/instances/' + INSTANCE), setup: heldForm() }),
    X('instance-unknown', INST, 404, { url: at('/instances/' + INSTANCE) }),
    X('instance-not-an-id', INST, 500, { url: at('/instances/nope'), setup: withRows(raisingOn(/FROM form_instance/, '22P02')) }),
    X('instance-answer-fails', INST, 500, { url: at('/instances/' + INSTANCE), setup: { jsonThrows: true, sqlRows: when(/FROM form_instance/, [row()]) } }),
    X('instance-library-throws', INST, 500, { url: at('/instances/' + INSTANCE), patch: { forms: { getInstance: thrown(SECRET_SQL) } } }),
    /* POST /instances/:id/sign */
    X('sign-by-name', SIGN, 200, { url: at('/instances/' + INSTANCE + '/sign'), body: { name: 'R Kumar', designation: 'Partner' }, setup: withRows(firstOf(when(/UPDATE form_instance SET signatory/, [{ form_id: INSTANCE, signed_at: '2026-10-02T00:00:00Z', signatory: { name: 'R Kumar', designation: 'Partner' } }]), when(/FROM form_instance WHERE entity_id = \$1 AND form_id = \$2/, [row()]))) }),
    X('sign-body-a-list', SIGN, 400, { url: at('/instances/' + INSTANCE + '/sign'), body: [], setup: heldForm() }),
    X('sign-no-signatory', SIGN, 400, { url: at('/instances/' + INSTANCE + '/sign'), body: {}, setup: heldForm() }),
    X('sign-already-signed', SIGN, 409, { url: at('/instances/' + INSTANCE + '/sign'), body: { name: 'R Kumar' }, setup: heldForm({ signed_at: '2026-10-02T00:00:00Z', signatory: { name: 'R Kumar' } }) }),
    X('sign-not-ready', SIGN, 400, { url: at('/instances/' + INSTANCE + '/sign'), body: { name: 'R Kumar' }, setup: heldForm({ ready: false }) }),
    X('sign-unknown', SIGN, 404, { url: at('/instances/' + INSTANCE + '/sign'), body: { name: 'R Kumar' } }),
    X('sign-write-fails', SIGN, 500, { url: at('/instances/' + INSTANCE + '/sign'), body: { name: 'R Kumar' }, setup: withRows(firstOf(raisingOn(/UPDATE form_instance SET signatory/, '53300'), when(/FROM form_instance WHERE entity_id = \$1 AND form_id = \$2/, [row()]))) }),
    X('sign-answer-fails', SIGN, 500, { url: at('/instances/' + INSTANCE + '/sign'), body: { name: 'R Kumar' }, setup: { jsonThrows: true, sqlRows: firstOf(when(/UPDATE form_instance SET signatory/, [{ form_id: INSTANCE, signed_at: '2026-10-02T00:00:00Z', signatory: { name: 'R Kumar' } }]), when(/FROM form_instance WHERE entity_id = \$1 AND form_id = \$2/, [row()])) } }),
    X('sign-library-throws', SIGN, 500, { url: at('/instances/' + INSTANCE + '/sign'), body: {}, patch: { forms: { signForm: thrown(SECRET_SQL) } } }),
    A('sign-unknown-key', SIGN, 422, { url: at('/instances/' + INSTANCE + '/sign'), body: { name: 'R Kumar', junk: 1 }, setup: signable }),
    /* POST /instances/:id/attach */
    X('attach-filed', ATTACH, 200, { url: at('/instances/' + INSTANCE + '/attach'), body: { chit_id: CHIT }, setup: roster, patch: filed }),
    X('attach-stamp-fails', ATTACH, 200, { url: at('/instances/' + INSTANCE + '/attach'), body: { chit_id: CHIT }, setup: withRows(firstOf(raisingOn(/UPDATE form_instance SET transfers/, '42703'), roster.sqlRows)), patch: filed }),
    X('attach-no-chit', ATTACH, 400, { url: at('/instances/' + INSTANCE + '/attach'), body: {} }),
    X('attach-body-a-list', ATTACH, 400, { url: at('/instances/' + INSTANCE + '/attach'), body: [] }),
    X('attach-not-a-participant', ATTACH, 403, { url: at('/instances/' + INSTANCE + '/attach'), body: { chit_id: OTHER_CHIT }, setup: heldForm() }),
    X('attach-unknown-instance', ATTACH, 404, { url: at('/instances/' + INSTANCE + '/attach'), body: { chit_id: CHIT } }),
    X('attach-store-missing', ATTACH, 503, { url: at('/instances/' + INSTANCE + '/attach'), body: { chit_id: CHIT }, setup: withRows(raisingOn(/FROM form_instance/, '42P01')) }),
    X('attach-storage-fails', ATTACH, 500, { url: at('/instances/' + INSTANCE + '/attach'), body: { chit_id: CHIT }, setup: roster, patch: { storage: { putForParticipants: thrown(SECRET_SQL) } } }),
    X('attach-answer-fails', ATTACH, 500, { url: at('/instances/' + INSTANCE + '/attach'), body: { chit_id: CHIT }, setup: { jsonThrows: true, sqlRows: roster.sqlRows }, patch: filed }),
    X('attach-library-throws', ATTACH, 500, { url: at('/instances/' + INSTANCE + '/attach'), body: { chit_id: CHIT }, patch: { forms: { attachToChit: thrown(SECRET_SQL) } } }),
    A('attach-unknown-key', ATTACH, 422, { url: at('/instances/' + INSTANCE + '/attach'), body: { chit_id: CHIT, junk: 1 }, setup: roster, patch: filed })
  ];
}

module.exports = { extras, universal, row, F, SHOP, SHOP_B, INSTANCE, CHIT, OTHER_CHIT, FORM, FULL, when, firstOf };

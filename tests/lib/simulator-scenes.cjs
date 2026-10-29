/**
 * simulator-scenes.cjs — the named scenarios of tests/api-problem-simulator.test.cjs: an answer the generic worlds cannot reach (a lead that is created, a feedback that names a lead, a thrown e-mail provider).
 *
 * OWNS      the extras: one scenario per answer of the 3 public routes of the /tour page (routes/simulator.js: content, lead, feedback), each with the stand-in database it needs. The stand-in MODELS the two
 *           tables the writes touch (`sim()`): sim_leads hands out an id, and sim_feedback.lead_id is a FOREIGN KEY to it (migrations/000_baseline_2026-10-21.sql:9028) with the column types of the baseline
 *           (lead_id uuid, rating integer), so a lead id nobody holds is 23503, a value Postgres cannot read as a uuid is 22P02, and a rating that is not a whole number is 22P02 / 22003, exactly as the
 *           real database answers (no RLS on either table, so the key is checked the same for every caller).
 * CALLED BY tests/api-problem-simulator.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, db }, body, url, headers, env, unsetEnv, mail, clock }] → the harness runs each one against the real route file
 * CARD      qa/offline-guards
 * Every name below is obviously made up (`Test Lead`, `lead@example.invalid`, `Test Org`): there is no person's data in this file. `mail` says what the stand-in e-mail provider does for that scene
 * ('records' keeps what was sent, 'throws' raises a string with SQL in it); `unsetEnv` removes a process variable for that one request (the harness can only set text); `clock` freezes Date.now so
 * the minted token (its iat and exp) is the same on every run and can be compared byte for byte.
 */
'use strict';

const MOUNT = '/api/simulator';
const KNOWN_LEAD = '3c9a1f52-7b1e-4d6a-8c2f-5e0a9b7d4c11';
const UNKNOWN_LEAD = '7d2e4b90-1a3c-4f58-9e6b-2c8d5a1f0e33';
const DASHES = '-'.repeat(36);
const HEX_36 = 'a'.repeat(36);
const CLOCK_MS = Date.parse('2026-10-24T10:00:00.000Z');
const INBOX = 'leads@example.invalid';
const FROM = 'from@example.invalid';
const SIM_SECRET_FOR_TESTS = 'sim-secret-for-tests';
const INT4_MAX = 2147483647;
/** Postgres reads a uuid as 32 hex digits with an optional single hyphen after each group of four (string_to_uuid): the 36-character shapes the route lets through are not all uuids */
const PG_UUID = /^(?:[0-9a-f]{4}-?){7}[0-9a-f]{4}$/i;
const canonical = (text) => text.replace(/-/g, '').toLowerCase();
const LEAD_BODY = { name: 'Test Lead', email: 'lead@example.invalid', org: 'Test Org' };
const FEEDBACK_BODY = { section: 'pricing', rating: 4, message: 'Test message', leadId: KNOWN_LEAD };

const SIX = {
  layers: [{ id: 1, ord: 1, name: 'Test layer', purpose: 'Test purpose' }],
  items: [{ id: 1, layer_id: 1, name: 'Test item', meaning: 'Test meaning', readiness: 'working', ex_pharmacy: null, ex_restaurant: null, pleasure: null, pain: null, decisive: null }],
  shapes: [{ id: 1, ord: 1, name: 'Test shape' }],
  rules: [{ id: 1, ord: 1, disposition: 'pass', name: 'Test rule' }],
  compare: [{ id: 1, ord: 1, neighbour: 'Test neighbour', does: 'Test does', difference: 'Test difference' }],
  usps: [{ id: 1, ord: 1, name: 'Test usp', readiness: 'designed' }]
};

/** the six content reads, answered by the table they name (a column the page never asked for rides along: `internal_note`, to show SELECT * hands out whatever the table holds) */
const contentRows = (plant) => (sql) => {
  const table = Object.keys(SIX).find((name) => new RegExp('FROM sim_' + name + '\\b').test(sql));
  if (!table) return null;
  const rows = SIX[table].map((row) => (plant ? Object.assign({}, row, { internal_note: 'planted' }) : row));
  return { rows, rowCount: rows.length };
};

/** the stand-in of the two tables the writes touch, with the column types of the baseline; sqlError is the harness's (a message and a SQLSTATE) */
function sim(sqlError, options) {
  const leads = new Set([canonical(KNOWN_LEAD)]);
  const empty = options && options.noRow;
  return (sql, params) => {
    if (/INSERT INTO sim_leads/.test(sql)) return empty ? { rows: [], rowCount: 0 } : { rows: [{ id: KNOWN_LEAD }], rowCount: 1 };
    if (!/INSERT INTO sim_feedback/.test(sql)) return null;
    const lead = params[0];
    if (lead !== null) {
      if (typeof lead !== 'string' || !PG_UUID.test(lead)) throw sqlError('22P02'); /* invalid input syntax for type uuid (an array is sent as the text {"..."}) */
      if (!leads.has(canonical(lead))) throw sqlError('23503'); /* the foreign key to sim_leads */
    }
    const rating = params[2];
    if (rating !== null) {
      const text = String(rating); /* node-pg sends a number as its text */
      if (!/^-?\d+$/.test(text)) throw sqlError('22P02');
      if (Math.abs(Number(text)) > INT4_MAX) throw sqlError('22003');
    }
    return { rows: [], rowCount: 1 };
  };
}

/** the tools a scene is built from: the harness's own stand-ins */
function extras(tools) {
  const { SECRET_SQL, sqlError } = tools;
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const sink = () => { throw new Error(SECRET_SQL); };
  const model = (options) => ({ sqlRows: sim(sqlError, options) });
  const GET_CONTENT = 'GET ' + MOUNT + '/content';
  const LEAD = 'POST ' + MOUNT + '/lead';
  const FEEDBACK = 'POST ' + MOUNT + '/feedback';
  const SENDS = { mail: 'records', env: { RESEND_API_KEY: 're_test_key', LEADS_EMAIL: INBOX } };
  const lead = (id, expect, body, more) => X(id, LEAD, expect, Object.assign({ body, setup: model(), clock: true }, more));
  const feedback = (id, expect, body, more) => X(id, FEEDBACK, expect, Object.assign({ body, setup: model() }, more));
  const withLead = (more) => Object.assign({}, FEEDBACK_BODY, more);

  const content = [
    X('content-listed', GET_CONTENT, 200, { setup: { sqlRows: contentRows(false) } }),
    X('content-passes-every-column', GET_CONTENT, 200, { setup: { sqlRows: contentRows(true) } }),
    X('content-query-string-ignored', GET_CONTENT, 200, { url: MOUNT + '/content?layer=1&x=2', setup: { sqlRows: contentRows(false) } }),
    X('content-bearer-ignored', GET_CONTENT, 200, { headers: { authorization: 'Bearer not-a-token' }, setup: { sqlRows: contentRows(false) } }),
    X('content-one-table-fails', GET_CONTENT, 500, { setup: { sqlRows: (sql) => (/FROM sim_rules\b/.test(sql) ? sink() : contentRows(false)(sql)) } }),
    X('content-leaks-nothing', GET_CONTENT, 500, { setup: { sqlRows: sink } }),
    X('content-answer-throws-leaks-nothing', GET_CONTENT, 500, { setup: { jsonThrows: true, sqlRows: contentRows(false) } })
  ];

  const leads = [
    lead('lead-created', 200, LEAD_BODY),
    lead('lead-without-org', 200, { name: 'Test Lead', email: 'lead@example.invalid' }),
    lead('lead-org-blank', 200, { name: 'Test Lead', email: 'lead@example.invalid', org: '   ' }),
    lead('lead-trimmed-and-lowered', 200, { name: '  Test Lead  ', email: '  Lead@Example.INVALID ', org: ' Test Org ' }),
    lead('lead-extra-keys-dropped', 200, Object.assign({ id: 'chosen-by-the-caller', leadId: UNKNOWN_LEAD, admin: true }, LEAD_BODY)),
    lead('lead-name-a-number', 200, { name: 12, email: 'n@example.invalid' }),
    lead('lead-name-a-list', 200, { name: ['Te', 'st'], email: 'n@example.invalid' }),
    lead('lead-email-just-an-at-sign', 200, { name: 'Test Lead', email: '@' }),
    lead('lead-name-too-short', 400, { name: 'A', email: 'lead@example.invalid' }),
    lead('lead-name-short-after-trim', 400, { name: '  A  ', email: 'lead@example.invalid' }),
    lead('lead-email-without-an-at-sign', 400, { name: 'Test Lead', email: 'lead.example.invalid' }),
    lead('lead-nothing-sent', 400, {}),
    lead('lead-body-a-list', 400, []),
    lead('lead-name-with-line-break', 200, { name: 'Test\r\nBcc: x@example.invalid Lead', email: 'lead@example.invalid' }, SENDS),
    lead('lead-name-with-markup', 200, { name: '<b>Test</b> & Lead', email: 'lead@example.invalid', org: '<i>Test Org</i>' }, SENDS),
    lead('lead-notify-sends', 200, LEAD_BODY, SENDS),
    lead('lead-notify-without-org', 200, { name: 'Test Lead', email: 'lead@example.invalid' }, SENDS),
    lead('lead-notify-skipped', 200, LEAD_BODY, {}),
    lead('lead-notify-no-inbox-skipped', 200, LEAD_BODY, { env: { RESEND_API_KEY: 're_test_key' } }),
    lead('lead-notify-from-address-is-the-inbox', 200, LEAD_BODY, { mail: 'records', env: { RESEND_API_KEY: 're_test_key', FROM_EMAIL: FROM } }),
    lead('lead-notify-throws-leaks-nothing', 200, LEAD_BODY, { mail: 'throws', env: SENDS.env }),
    lead('lead-token-with-its-own-secret', 200, LEAD_BODY, { env: { SIM_JWT_SECRET: SIM_SECRET_FOR_TESTS } }),
    lead('lead-token-with-its-own-ttl', 200, LEAD_BODY, { env: { JWT_TTL: '1h' } }),
    lead('lead-token-with-no-secret-at-all', 200, LEAD_BODY, { unsetEnv: ['JWT_SECRET', 'SIM_JWT_SECRET'] }),
    lead('lead-insert-fails', 500, LEAD_BODY, { setup: { db: 'fail' } }),
    lead('lead-fails-leaks-nothing', 500, LEAD_BODY, { setup: { sqlRows: sink } }),
    lead('lead-insert-returns-no-row', 500, LEAD_BODY, { setup: model({ noRow: true }) }),
    lead('lead-answer-throws-leaks-nothing', 500, LEAD_BODY, { setup: Object.assign(model(), { jsonThrows: true }) })
  ];

  const feedbacks = [
    feedback('feedback-recorded', 200, FEEDBACK_BODY),
    feedback('feedback-message-only', 200, { message: 'Test message' }),
    feedback('feedback-extra-keys-dropped', 200, Object.assign({ id: 'chosen-by-the-caller', created_at: '2020-01-01', admin: true }, FEEDBACK_BODY)),
    feedback('feedback-lead-uppercase', 200, withLead({ leadId: KNOWN_LEAD.toUpperCase() })),
    feedback('feedback-lead-hyphens-moved', 200, withLead({ leadId: canonical(KNOWN_LEAD).replace(/(.{4})(.{4})(.{4})(.{4})(.*)/, '$1-$2-$3-$4-$5') })),
    feedback('feedback-lead-too-short-ignored', 200, withLead({ leadId: 'abc' })),
    feedback('feedback-lead-too-long-ignored', 200, withLead({ leadId: KNOWN_LEAD + 'a' })),
    feedback('feedback-lead-unknown-uuid', 500, withLead({ leadId: UNKNOWN_LEAD })),
    feedback('feedback-lead-not-a-uuid', 500, withLead({ leadId: DASHES })),
    feedback('feedback-lead-36-hex-digits', 500, withLead({ leadId: HEX_36 })),
    feedback('feedback-lead-in-a-list', 500, withLead({ leadId: [KNOWN_LEAD] })),
    feedback('feedback-nothing-sent', 400, {}),
    feedback('feedback-message-blank', 400, { message: '   ' }),
    feedback('feedback-message-zero', 400, { message: 0 }),
    feedback('feedback-body-a-list', 400, []),
    feedback('feedback-message-a-number', 200, { message: 7 }),
    feedback('feedback-rating-as-text', 200, withLead({ rating: '5' })),
    feedback('feedback-rating-negative', 200, withLead({ rating: -3 })),
    feedback('feedback-rating-zero', 200, withLead({ rating: 0 }), SENDS),
    feedback('feedback-rating-empty-text', 200, withLead({ rating: '' })),
    feedback('feedback-rating-null', 200, withLead({ rating: null })),
    feedback('feedback-rating-true', 200, withLead({ rating: true })),
    feedback('feedback-rating-in-a-list', 200, withLead({ rating: [5] })),
    feedback('feedback-rating-not-a-number', 200, withLead({ rating: 'abc' })),
    feedback('feedback-rating-decimal', 500, withLead({ rating: 3.5 })),
    feedback('feedback-rating-too-big-for-the-column', 500, withLead({ rating: 5000000000 })),
    feedback('feedback-section-blank', 200, withLead({ section: '   ' }), SENDS),
    feedback('feedback-section-with-line-break', 200, withLead({ section: 'pricing\r\nBcc: x@example.invalid' }), SENDS),
    feedback('feedback-message-with-markup', 200, withLead({ message: '<b>Test</b> & message', section: '<i>pricing</i>' }), SENDS),
    feedback('feedback-notify-sends', 200, FEEDBACK_BODY, SENDS),
    feedback('feedback-notify-skipped', 200, FEEDBACK_BODY, {}),
    feedback('feedback-notify-throws-leaks-nothing', 200, FEEDBACK_BODY, { mail: 'throws', env: SENDS.env }),
    feedback('feedback-insert-fails', 500, FEEDBACK_BODY, { setup: { db: 'fail' } }),
    feedback('feedback-fails-leaks-nothing', 500, FEEDBACK_BODY, { setup: { sqlRows: sink } }),
    feedback('feedback-answer-throws-leaks-nothing', 500, FEEDBACK_BODY, { setup: Object.assign(model(), { jsonThrows: true }) })
  ];

  return [].concat(content, leads, feedbacks);
}

module.exports = { extras, sim, MOUNT, KNOWN_LEAD, UNKNOWN_LEAD, DASHES, HEX_36, CLOCK_MS, INBOX, FROM, SIM_SECRET_FOR_TESTS, LEAD_BODY, FEEDBACK_BODY, PG_UUID };

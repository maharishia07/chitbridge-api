/**
 * service-scenes.cjs — the named scenarios of tests/api-problem-service.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler, a success to prove byte for byte).
 *
 * OWNS      the extras: one scenario per answer of the 7 routes of routes/service.js (the service clock: start · respond · resolve · pause · end the pause · answer the pause), each with the
 *           stand-in rows it needs (answered by the shape of the statement, so the same facts meet old and new code), and the rows of the foreign-id world.
 * CALLED BY tests/api-problem-service.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, body, url, after, throws }] → the harness runs each one against the real route
 * CARD      02-tasks-orders-and-workflow/README
 */
'use strict';

const SVC = '/api/service';
const SHOP = '11111111-1111-4111-8111-111111111111';
const STRANGER_ID = '66666666-6666-4666-8666-666666666666';
const CHIT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PAUSE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const STAMP = '2026-10-01T09:00:00.000Z';

/** a chit_sla row, every b147 column */
const RECORD_ROW = {
  chit_id: CHIT, entity_id: SHOP, impact: 'high', urgency: 'high', priority: 'P1', raised_at: STAMP, responded_at: null, resolved_at: null, closed_at: null,
  resolution_code: null, resolution_note: null, closed_by_counterparty: null, policy: null, created_at: STAMP, updated_at: STAMP
};
/** a chit_sla_pause row as the read selects it: one claimed by this shop, one by the other party */
const PAUSE_ROW = { pause_id: PAUSE, paused_from: STAMP, paused_to: null, reason: 'waiting_on_counterparty', note: null, on_counterparty: true, claimed_by_entity_id: SHOP, claimed_by_name: 'Test shop', accepted: null, accepted_at: null, accepted_by: null };
const THEIR_PAUSE = Object.assign({}, PAUSE_ROW, { pause_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', claimed_by_entity_id: STRANGER_ID, claimed_by_name: 'Shop B', on_counterparty: false });
/** a column that is in no list: the stand-in table holds it, and no answer may carry it (the allow-list, S34) */
const EXTRA_COLUMN = 'extra_column';

/** the tools a scene is built from: the harness's own stand-ins, and the sentence the database must never be heard in */
function extras(tools) {
  const { STAFF, SECRET_SQL, answering, firstOf } = tools;
  const STRANGER = { identity_id: STRANGER_ID, identity_type: 'entity', display_name: 'Shop B' };
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  /** a scenario for an answer the sweep ADDS (a key nobody reads is refused): nothing was frozen for it, the old code took it */
  const N = (id, route, expect, more) => X(id, route, expect, Object.assign({ after: true }, more));
  const at = (tail) => SVC + (tail || '');
  const key = (verb, tail) => verb + ' ' + at(tail);
  /** rows only to the shop that owns them, as `WHERE entity_id = $1` and RLS would answer: the statement must name SHOP */
  const ownedBy = (pattern, rows) => (sql, params) => (pattern.test(sql) && (params || []).includes(SHOP) ? { rows, rowCount: rows.length } : null);
  const held = ownedBy(/FROM chit_header WHERE chit_id/, [{ role: 'sender' }]);
  const tracked = ownedBy(/FROM chit_sla WHERE/, [RECORD_ROW]);
  const pauses = ownedBy(/FROM chit_sla_pause WHERE entity_id=\$1 AND chit_id=\$2 ORDER/, [PAUSE_ROW, THEIR_PAUSE]);
  const withRows = (...answers) => ({ sqlRows: firstOf(held, ...answers) });
  /** a SQL function takes no shop (the chit is checked first by `mine`): it answers whoever asks */
  const funcRows = (pattern, copies) => answering(pattern, [{ copies }]);
  /** a stand-in that raises: the database's own words, or the library's refusal sentence */
  const raisingText = (pattern, text, code) => (sql) => {
    if (pattern.test(sql)) throw Object.assign(new Error(text), code ? { code } : {});
    return null;
  };
  const GOOD = { impact: 'high', urgency: 'high' };

  return [
    /* GET — the clock, both ways */
    X('get-tracked', key('GET', '/:chit_id'), 200, { setup: withRows(tracked, pauses) }),
    X('get-untracked', key('GET', '/:chit_id'), 200, { setup: withRows() }),
    X('get-not-migrated', key('GET', '/:chit_id'), 503, { setup: { sqlRows: raisingText(/FROM chit_header/, 'relation "chit_header" does not exist', '42P01') } }),
    N('get-extra-column', key('GET', '/:chit_id'), 200, { setup: withRows(ownedBy(/FROM chit_sla WHERE/, [Object.assign({ [EXTRA_COLUMN]: SECRET_SQL }, RECORD_ROW)]), ownedBy(/FROM chit_sla_pause WHERE entity_id=\$1 AND chit_id=\$2 ORDER/, [Object.assign({ [EXTRA_COLUMN]: SECRET_SQL }, PAUSE_ROW)])), extraColumn: true }),
    X('get-reads-throw', key('GET', '/:chit_id'), 500, { setup: withRows(raisingText(/FROM chit_sla WHERE/, SECRET_SQL)), throws: true }),
    /* PUT — start, or change */
    X('put-start', key('PUT', '/:chit_id'), 200, { body: GOOD, setup: withRows(ownedBy(/INSERT INTO chit_sla/, [RECORD_ROW])) }),
    X('put-start-by-staff', key('PUT', '/:chit_id'), 200, { body: GOOD, setup: Object.assign({ who: STAFF }, withRows(ownedBy(/INSERT INTO chit_sla/, [RECORD_ROW]))) }),
    X('put-priority-by-hand', key('PUT', '/:chit_id'), 200, { body: { priority: 'p2', policy: { respond_ms: 1 } }, setup: withRows(ownedBy(/INSERT INTO chit_sla/, [RECORD_ROW])) }),
    X('put-bad-priority', key('PUT', '/:chit_id'), 400, { body: { priority: 'P9' }, setup: withRows() }),
    X('put-wrong-kind', key('PUT', '/:chit_id'), 400, { body: { impact: 5 }, setup: withRows() }),
    X('put-not-migrated', key('PUT', '/:chit_id'), 503, { body: GOOD, setup: withRows(raisingText(/INSERT INTO chit_sla/, 'relation "chit_sla" does not exist', '42P01')) }),
    X('put-write-throws', key('PUT', '/:chit_id'), 500, { body: GOOD, setup: withRows(raisingText(/INSERT INTO chit_sla/, SECRET_SQL)), throws: true }),
    N('put-unknown-key', key('PUT', '/:chit_id'), 400, { body: Object.assign({ zz_unknown_field: 'x' }, GOOD), setup: withRows(ownedBy(/INSERT INTO chit_sla/, [RECORD_ROW])) }),
    N('put-list-body', key('PUT', '/:chit_id'), 400, { body: [], setup: withRows(ownedBy(/INSERT INTO chit_sla/, [RECORD_ROW])) }),
    /* respond */
    X('respond-ok', key('POST', '/:chit_id/respond'), 200, { setup: withRows(ownedBy(/UPDATE chit_sla SET responded_at/, [{ responded_at: STAMP }])) }),
    X('respond-not-tracked', key('POST', '/:chit_id/respond'), 404, { setup: withRows() }),
    X('respond-not-migrated', key('POST', '/:chit_id/respond'), 503, { setup: withRows(raisingText(/UPDATE chit_sla/, 'column "responded_at" does not exist', '42703')) }),
    N('respond-unknown-key', key('POST', '/:chit_id/respond'), 400, { body: { zz_unknown_field: 'x' }, setup: withRows(ownedBy(/UPDATE chit_sla SET responded_at/, [{ responded_at: STAMP }])) }),
    /* resolve */
    X('resolve-ok', key('POST', '/:chit_id/resolve'), 200, { body: { resolution_code: 'fixed', note: 'replaced the part' }, setup: withRows(ownedBy(/UPDATE chit_sla SET resolved_at/, [{ resolved_at: STAMP, resolution_code: 'fixed' }])) }),
    X('resolve-bad-code', key('POST', '/:chit_id/resolve'), 400, { body: { resolution_code: 'nope' }, setup: withRows() }),
    X('resolve-not-tracked', key('POST', '/:chit_id/resolve'), 404, { body: { resolution_code: 'fixed' }, setup: withRows() }),
    X('resolve-write-throws', key('POST', '/:chit_id/resolve'), 500, { body: { resolution_code: 'fixed' }, setup: withRows(raisingText(/UPDATE chit_sla SET resolved_at/, SECRET_SQL)), throws: true }),
    N('resolve-unknown-key', key('POST', '/:chit_id/resolve'), 400, { body: { resolution_code: 'fixed', zz_unknown_field: 'x' }, setup: withRows(ownedBy(/UPDATE chit_sla SET resolved_at/, [{ resolved_at: STAMP, resolution_code: 'fixed' }])) }),
    /* pause */
    X('pause-ok', key('POST', '/:chit_id/pause'), 200, { body: { reason: 'waiting_on_counterparty', note: 'waiting on the part', on_counterparty: true }, setup: withRows(funcRows(/chit_sla_pause_start/, 2)) }),
    X('pause-chit-unknown', key('POST', '/:chit_id/pause'), 404, { body: { reason: 'waiting_on_counterparty' }, setup: {} }),
    X('pause-extra-column', key('POST', '/:chit_id/pause'), 200, { body: { reason: 'waiting_on_counterparty' }, setup: withRows(answering(/chit_sla_pause_start/, [{ copies: 2, [EXTRA_COLUMN]: SECRET_SQL }])), extraColumn: true }),
    X('pause-already', key('POST', '/:chit_id/pause'), 409, { body: { reason: 'waiting_on_counterparty' }, setup: withRows(ownedBy(/FROM chit_sla_pause\s+WHERE entity_id=\$1 AND chit_id=\$2 AND paused_to IS NULL/, [{ pause_id: PAUSE }])) }),
    X('pause-bad-reason', key('POST', '/:chit_id/pause'), 400, { body: { reason: 'nope' }, setup: withRows() }),
    X('pause-write-throws', key('POST', '/:chit_id/pause'), 500, { body: { reason: 'waiting_on_counterparty' }, setup: withRows(raisingText(/chit_sla_pause_start/, SECRET_SQL)), throws: true }),
    N('pause-unknown-key', key('POST', '/:chit_id/pause'), 400, { body: { reason: 'waiting_on_counterparty', zz_unknown_field: 'x' }, setup: withRows(funcRows(/chit_sla_pause_start/, 2)) }),
    /* end the pause */
    X('end-ok', key('POST', '/:chit_id/pause/:pause_id/end'), 200, { setup: withRows(funcRows(/chit_sla_pause_end/, 2)) }),
    X('end-extra-column', key('POST', '/:chit_id/pause/:pause_id/end'), 200, { setup: withRows(answering(/chit_sla_pause_end/, [{ copies: 2, [EXTRA_COLUMN]: SECRET_SQL }])), extraColumn: true }),
    X('end-already-closed', key('POST', '/:chit_id/pause/:pause_id/end'), 409, { setup: withRows(funcRows(/chit_sla_pause_end/, 0)) }),
    N('end-unknown-key', key('POST', '/:chit_id/pause/:pause_id/end'), 400, { body: { zz_unknown_field: 'x' }, setup: withRows(funcRows(/chit_sla_pause_end/, 2)) }),
    X('end-not-migrated', key('POST', '/:chit_id/pause/:pause_id/end'), 503, { setup: withRows(raisingText(/chit_sla_pause_end/, 'function chit_sla_pause_end does not exist', '42883')) }),
    /* answer the pause */
    X('answer-accept', key('POST', '/:chit_id/pause/:pause_id/answer'), 200, { body: { accepted: true }, setup: withRows(funcRows(/chit_sla_pause_answer/, 2)) }),
    X('answer-chit-unknown', key('POST', '/:chit_id/pause/:pause_id/answer'), 404, { body: { accepted: true }, setup: {} }),
    X('answer-reject', key('POST', '/:chit_id/pause/:pause_id/answer'), 200, { body: { accepted: false }, setup: withRows(funcRows(/chit_sla_pause_answer/, 2)) }),
    X('answer-own-claim', key('POST', '/:chit_id/pause/:pause_id/answer'), 409, { body: { accepted: true }, setup: withRows(raisingText(/chit_sla_pause_answer/, 'a party cannot answer its own claim')) }),
    N('answer-unknown-key', key('POST', '/:chit_id/pause/:pause_id/answer'), 400, { body: { accepted: true, zz_unknown_field: 'x' }, setup: withRows(funcRows(/chit_sla_pause_answer/, 2)) }),
    X('answer-wrong-kind', key('POST', '/:chit_id/pause/:pause_id/answer'), 400, { body: { accepted: 'maybe' }, setup: withRows() }),
    X('answer-write-throws', key('POST', '/:chit_id/pause/:pause_id/answer'), 500, { body: { accepted: true }, setup: withRows(raisingText(/chit_sla_pause_answer/, SECRET_SQL)), throws: true }),
    /* a stranger asking about a chit that is held by SHOP: the same answer as an unknown one (S35) */
    X('stranger-reads', key('GET', '/:chit_id'), 404, { setup: { who: STRANGER, sqlRows: firstOf(held, tracked, pauses) } })
  ];
}

/** the seven routes the foreign-id world plays: the url, the valid body, and the rows that make the chit the owner's own */
function foreignRoutes(answering) {
  const held = (sql, params) => (/FROM chit_header WHERE chit_id/.test(sql) && (params || []).includes(SHOP) ? { rows: [{ role: 'sender' }], rowCount: 1 } : null);
  const rowsOf = (pattern, rows) => (sql, params) => (pattern.test(sql) && (params || []).includes(SHOP) ? { rows, rowCount: rows.length } : null);
  const chain = (...answers) => (sql, params) => answers.map((answer) => answer(sql, params)).find((given) => given) || null;
  const at = (tail) => SVC + '/' + CHIT + (tail || '');
  const pauseUrl = (tail) => at('/pause/' + PAUSE + tail);
  return [
    { route: 'GET ' + SVC + '/:chit_id', method: 'GET', url: at(), rows: chain(held, rowsOf(/FROM chit_sla WHERE/, [RECORD_ROW]), rowsOf(/FROM chit_sla_pause WHERE/, [PAUSE_ROW])) },
    { route: 'PUT ' + SVC + '/:chit_id', method: 'PUT', url: at(), body: { impact: 'high', urgency: 'high' }, rows: chain(held, rowsOf(/INSERT INTO chit_sla/, [RECORD_ROW])) },
    { route: 'POST ' + SVC + '/:chit_id/respond', method: 'POST', url: at('/respond'), body: {}, rows: chain(held, rowsOf(/UPDATE chit_sla SET responded_at/, [{ responded_at: STAMP }])) },
    { route: 'POST ' + SVC + '/:chit_id/resolve', method: 'POST', url: at('/resolve'), body: { resolution_code: 'fixed' }, rows: chain(held, rowsOf(/UPDATE chit_sla SET resolved_at/, [{ resolved_at: STAMP, resolution_code: 'fixed' }])) },
    { route: 'POST ' + SVC + '/:chit_id/pause', method: 'POST', url: at('/pause'), body: { reason: 'waiting_on_counterparty' }, rows: chain(held, answering(/chit_sla_pause_start/, [{ copies: 2 }])) },
    { route: 'POST ' + SVC + '/:chit_id/pause/:pause_id/end', method: 'POST', url: pauseUrl('/end'), body: {}, rows: chain(held, answering(/chit_sla_pause_end/, [{ copies: 1 }])) },
    { route: 'POST ' + SVC + '/:chit_id/pause/:pause_id/answer', method: 'POST', url: pauseUrl('/answer'), body: { accepted: true }, rows: chain(held, answering(/chit_sla_pause_answer/, [{ copies: 1 }])) }
  ];
}

module.exports = { extras, foreignRoutes, STRANGER_ID, SHOP, CHIT, PAUSE, EXTRA_COLUMN, RECORD_ROW, PAUSE_ROW, THEIR_PAUSE };

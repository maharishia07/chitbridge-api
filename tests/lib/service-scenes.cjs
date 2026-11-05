/**
 * service-scenes.cjs — the named scenarios of tests/api-problem-service.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler of routes/service.js, the 2xx answers the sweep keeps still).
 *
 * OWNS      the stand-in database rows of a chit's service clock and the extras: one scenario per refusal the seven routes of routes/service.js (/api/service) make themselves, one per success answer,
 *           and the values no column can hold (a NUL byte in text, a time Postgres cannot read), which Postgres refuses with 22021 / 22P05 / 22007 and which answered 500.
 * CALLED BY tests/api-problem-service.test.cjs. Not a test itself.
 * FLOW      extras() → [{ id, route, expect, setup: { sqlRows }, body }] → the harness runs each one against the real route
 * CARD      03-disputes-service-and-register/service-request-sla-pause
 * A NUL byte is written as the escape "\u0000" here, never as the raw byte (a raw byte makes git treat the file as binary).
 */
'use strict';
const { PARTY } = require('./problem-world.cjs');

const NUL = '\u0000';
const AT = new Date(Date.UTC(2026, 10, 4, 6, 0, 0));
const TRACKED = { chit_id: PARTY, impact: 'high', urgency: 'high', priority: 'P1', raised_at: AT, responded_at: null, resolved_at: null, policy: null };
const REASON = 'waiting_on_counterparty';

/** an error the way pg raises one */
const pgError = (code, message) => Object.assign(new Error(message || 'pg ' + code), { code });
/** the stand-in db keeps Postgres's rules: a NUL byte in any value is refused 22021 (22P05 inside a jsonb value), and a time it cannot read 22007 */
const holdsJunk = (sql, params) => {
  (params || []).forEach((one) => {
    if (typeof one === 'string' && one.includes(NUL)) throw pgError('22021', 'invalid byte sequence for encoding "UTF8": 0x00');
    if (typeof one === 'string' && /^\{/.test(one) && one.includes('\\u0000')) throw pgError('22P05', 'unsupported Unicode escape sequence'); /* a jsonb value holding the escape of a NUL byte */
  });
  if (/chit_sla_pause_start/.test(sql) && typeof params[2] === 'string' && Number.isNaN(Date.parse(params[2]))) throw pgError('22007', 'invalid input syntax for type timestamp with time zone');
  return null;
};
/** the rows of one statement, by its shape */
const answering = (pattern, rows) => (sql) => (pattern.test(String(sql)) ? { rows, rowCount: rows.length } : null);
const firstOf = (...answers) => (sql, params) => answers.map((answer) => answer(sql, params)).find((given) => given) || null;
/** a chit this shop holds, and what each statement of the service clock answers when it works */
const HELD = answering(/FROM chit_header/, [{ role: 'buyer' }]);
const WORKS = firstOf(
  HELD,
  answering(/INSERT INTO chit_sla/, [TRACKED]),
  answering(/SET responded_at/, [{ responded_at: AT }]),
  answering(/SET resolved_at/, [{ resolved_at: AT, resolution_code: 'fixed' }]),
  answering(/chit_sla_pause_(start|end|answer)/, [{ copies: 2 }])
);
/** a world: the chit is held and every statement works, but for the rows this scene lays over it first */
const held = (...laidOver) => ({ sqlRows: firstOf(holdsJunk, ...laidOver, WORKS) });
const raising = (code, pattern, message) => (sql) => {
  if (pattern.test(String(sql))) throw pgError(code, message);
  return null;
};

function extras() {
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const at = (path) => '/api/service/' + PARTY + path;
  const PAUSE = '/pause/' + PARTY;
  const NOT_MIGRATED = { sqlRows: raising('42P01', /chit_header/) };
  return [
    /* read */
    X('get-untracked', 'GET /api/service/:chit_id', 200, { url: at(''), setup: held() }),
    X('get-tracked', 'GET /api/service/:chit_id', 200, { url: at(''), setup: held(answering(/FROM chit_sla WHERE/, [{ ...TRACKED, responded_at: AT, resolved_at: new Date(AT.getTime() + 3600000) }])) }),
    X('get-not-migrated', 'GET /api/service/:chit_id', 503, { url: at(''), setup: NOT_MIGRATED }),
    /* start tracking */
    X('put-unknown-key-refused', 'PUT /api/service/:chit_id', 422, { url: at(''), body: { colour: 'red', impact: 'High', urgency: 'high' }, setup: held() }),
    X('put-starts-tracking', 'PUT /api/service/:chit_id', 200, { url: at(''), body: { impact: 'High', urgency: 'high' }, setup: held() }),
    X('put-priority-not-one-of-the-list', 'PUT /api/service/:chit_id', 400, { url: at(''), body: { priority: 'zz' }, setup: held() }),
    X('put-impact-not-text', 'PUT /api/service/:chit_id', 400, { url: at(''), body: { impact: 5 }, setup: held() }),
    X('put-impact-with-a-nul-byte', 'PUT /api/service/:chit_id', 400, { url: at(''), body: { impact: 'hi' + NUL + 'gh' }, setup: held() }),
    X('put-urgency-with-a-nul-byte', 'PUT /api/service/:chit_id', 400, { url: at(''), body: { urgency: 'hi' + NUL + 'gh' }, setup: held() }),
    X('put-policy-with-a-nul-byte', 'PUT /api/service/:chit_id', 400, { url: at(''), body: { policy: { note: 'a' + NUL + 'b' } }, setup: held() }),
    /* respond */
    X('respond-unknown-key-refused', 'POST /api/service/:chit_id/respond', 422, { url: at('/respond'), body: { colour: 'red' }, setup: held() }),
    X('respond-records', 'POST /api/service/:chit_id/respond', 200, { url: at('/respond'), setup: held() }),
    X('respond-not-tracked', 'POST /api/service/:chit_id/respond', 404, { url: at('/respond'), setup: held(answering(/SET responded_at/, [])) }),
    /* resolve */
    X('resolve-unknown-key-refused', 'POST /api/service/:chit_id/resolve', 422, { url: at('/resolve'), body: { colour: 'red', resolution_code: 'fixed', note: 'done' }, setup: held() }),
    X('resolve-records', 'POST /api/service/:chit_id/resolve', 200, { url: at('/resolve'), body: { resolution_code: 'fixed', note: 'done' }, setup: held() }),
    X('resolve-names-no-code', 'POST /api/service/:chit_id/resolve', 400, { url: at('/resolve'), body: {}, setup: held() }),
    X('resolve-code-not-one-of-the-list', 'POST /api/service/:chit_id/resolve', 400, { url: at('/resolve'), body: { resolution_code: 'zz' }, setup: held() }),
    X('resolve-note-with-a-nul-byte', 'POST /api/service/:chit_id/resolve', 400, { url: at('/resolve'), body: { resolution_code: 'fixed', note: 'a' + NUL + 'b' }, setup: held() }),
    X('resolve-not-tracked', 'POST /api/service/:chit_id/resolve', 404, { url: at('/resolve'), body: { resolution_code: 'fixed' }, setup: held(answering(/SET resolved_at/, [])) }),
    /* pause */
    X('pause-unknown-key-refused', 'POST /api/service/:chit_id/pause', 422, { url: at('/pause'), body: { colour: 'red', reason: REASON, from: '2026-11-04T06:00:00Z' }, setup: held() }),
    X('pause-starts', 'POST /api/service/:chit_id/pause', 200, { url: at('/pause'), body: { reason: REASON, from: '2026-11-04T06:00:00Z' }, setup: held() }),
    X('pause-reason-not-one-of-the-list', 'POST /api/service/:chit_id/pause', 400, { url: at('/pause'), body: { reason: 'zz' }, setup: held() }),
    X('pause-already-open', 'POST /api/service/:chit_id/pause', 409, { url: at('/pause'), body: { reason: REASON }, setup: held(answering(/paused_to IS NULL/, [{ pause_id: PARTY }])) }),
    X('pause-note-with-a-nul-byte', 'POST /api/service/:chit_id/pause', 400, { url: at('/pause'), body: { reason: REASON, note: 'a' + NUL + 'b' }, setup: held() }),
    X('pause-time-not-a-time', 'POST /api/service/:chit_id/pause', 400, { url: at('/pause'), body: { reason: REASON, from: 'abc' }, setup: held() }),
    X('pause-time-with-a-nul-byte', 'POST /api/service/:chit_id/pause', 400, { url: at('/pause'), body: { reason: REASON, from: '2026-11-04' + NUL }, setup: held() }),
    /* end */
    X('end-unknown-key-refused', 'POST /api/service/:chit_id/pause/:pause_id/end', 422, { url: at(PAUSE + '/end'), body: { colour: 'red' }, setup: held() }),
    X('end-restarts', 'POST /api/service/:chit_id/pause/:pause_id/end', 200, { url: at(PAUSE + '/end'), setup: held() }),
    X('end-time-not-a-time', 'POST /api/service/:chit_id/pause/:pause_id/end', 400, { url: at(PAUSE + '/end'), body: { to: 'abc' }, setup: held() }),
    X('end-time-with-a-nul-byte', 'POST /api/service/:chit_id/pause/:pause_id/end', 400, { url: at(PAUSE + '/end'), body: { to: '2026-11-04T06:00:00Z' + NUL }, setup: held() }),
    X('end-already-ended', 'POST /api/service/:chit_id/pause/:pause_id/end', 409, { url: at(PAUSE + '/end'), setup: held(answering(/chit_sla_pause_end/, [{ copies: 0 }])) }),
    /* answer */
    X('answer-unknown-key-refused', 'POST /api/service/:chit_id/pause/:pause_id/answer', 422, { url: at(PAUSE + '/answer'), body: { colour: 'red', accepted: true }, setup: held() }),
    X('answer-accepts', 'POST /api/service/:chit_id/pause/:pause_id/answer', 200, { url: at(PAUSE + '/answer'), body: { accepted: true }, setup: held() }),
    X('answer-not-yes-or-no', 'POST /api/service/:chit_id/pause/:pause_id/answer', 400, { url: at(PAUSE + '/answer'), body: { accepted: 'maybe' }, setup: held() }),
    X('answer-own-claim', 'POST /api/service/:chit_id/pause/:pause_id/answer', 409, { url: at(PAUSE + '/answer'), body: { accepted: true }, setup: held(raising('P0001', /chit_sla_pause_answer/, 'chit_sla_pause_answer: a party cannot answer its own claim')) })
  ];
}

module.exports = { extras, NUL };

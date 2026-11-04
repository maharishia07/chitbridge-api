/**
 * signin-scenes.cjs — the named scenarios of tests/api-problem-signin.test.cjs: an answer the generic worlds cannot reach (a refusal inside a handler of routes/signin.js).
 *
 * OWNS      the stand-in database rows of the sign-in doors and the extras: one scenario per refusal the eight routes of routes/signin.js (/api/signin) make themselves, and the
 *           text no sign-in door may turn into a fault (a NUL byte: Postgres refuses it with 22021, and a door that let it through answered 500).
 * CALLED BY tests/api-problem-signin.test.cjs. Not a test itself.
 * FLOW      extras() → [{ id, route, expect, setup: { sqlRows, who }, body, patch, like }] → the harness runs each one against the real route
 * CARD      18-identity-sign-in-and-access/sign-in
 * `like` pairs a junk scene with the unknown-value scene it must answer exactly like (S41): the test compares the two answers, status and body, byte for byte.
 */
'use strict';
const { STAFF, OWNER } = require('./problem-world.cjs');

const NUL = '\u0000';
const DEVICE = 'device-aaaa-1111';
const OTHER_DEVICE = 'device-bbbb-2222';
const LATER = 1900000000;
const DEVICES = { [DEVICE]: { label: null, sessions: [{ jti: 'jti-of-someone-else', iat: 1, exp: LATER, by: '99999999-9999-4999-8999-999999999999', surface: 'web' }] } };

/** an error the way pg raises one */
const pgError = (code, message) => Object.assign(new Error(message || 'pg ' + code), { code });
/** the stand-in db keeps Postgres's text rule: a NUL byte in any value is refused 22021, as the real column read would */
const holdsNul = (sql, params) => {
  if ((params || []).some((one) => typeof one === 'string' && one.includes(NUL))) throw pgError('22021', 'invalid byte sequence for encoding "UTF8": 0x00');
  return null;
};
/** the rows of one statement, by its shape */
const answering = (pattern, rows) => (sql) => (pattern.test(String(sql)) ? { rows, rowCount: rows.length } : null);
const TWO_SHOPS = answering(/LOWER\(display_name\) = LOWER/, [
  { identity_id: 'a', bridge_id: 'A', email: 'a@x.com', display_name: 'Tea Shop' },
  { identity_id: 'b', bridge_id: 'B', email: 'b@x.com', display_name: 'Tea Shop' }
]);
const FAILING = { db: 'fail' };

function extras() {
  const X = (id, route, expect, more) => Object.assign({ id, route, expect, setup: {} }, more);
  const at = (path) => '/api/signin' + path;
  const NUL_DB = { sqlRows: holdsNul };
  const refusing = (code) => ({ identityAuth: { verifyCredential: async () => ({ ok: true }), issueToken: async () => { throw Object.assign(new Error(code), { code }); } } });
  const KNOWN = { sqlRows: answering(/FROM identities WHERE email = \$1/, [{ identity_id: 'a', bridge_id: 'A', display_name: 'Tea Shop', email: 'a@x.com', identity_type: 'entity' }]) };
  return [
    /* renew */
    X('renew-legacy-token-names-no-device', 'POST ' + at('/renew'), 400, { body: {} }),
    /* revoke */
    X('revoke-names-nothing', 'POST ' + at('/sessions/revoke'), 400, { body: {} }),
    X('revoke-device-id-is-not-one', 'POST ' + at('/sessions/revoke'), 400, { body: { device_id: 'x' } }),
    X('revoke-device-unknown', 'POST ' + at('/sessions/revoke'), 404, { body: { device_id: OTHER_DEVICE } }),
    X('revoke-device-by-staff', 'POST ' + at('/sessions/revoke'), 403, { body: { device_id: DEVICE }, setup: { who: STAFF } }),
    X('revoke-someone-elses-session', 'POST ' + at('/sessions/revoke'), 403, { body: { jti: 'jti-of-someone-else' }, setup: { who: STAFF, sqlRows: answering(/SELECT policy_flags/, [{ policy_flags: { devices: DEVICES } }]) } }),
    X('revoke-db-fails', 'POST ' + at('/sessions/revoke'), 500, { body: { jti: 'any' }, setup: FAILING }),
    /* ask */
    X('ask-nothing-typed', 'POST ' + at('/ask'), 400, { body: {} }),
    X('ask-name-too-short', 'POST ' + at('/ask'), 400, { body: { id: 'ghost', display_name: 'x' } }),
    X('ask-unknown-account', 'POST ' + at('/ask'), 400, { body: { id: 'ghost' } }),
    X('ask-unknown-email', 'POST ' + at('/ask'), 400, { body: { email: 'ghost@x.com' } }),
    X('ask-two-businesses-of-one-name', 'POST ' + at('/ask'), 409, { body: { id: 'Tea Shop' }, setup: { sqlRows: TWO_SHOPS } }),
    X('ask-db-fails', 'POST ' + at('/ask'), 500, { body: { id: 'ghost' }, setup: FAILING }),
    X('ask-id-with-a-nul-byte', 'POST ' + at('/ask'), 400, { body: { id: 'gh' + NUL + 'ost' }, setup: NUL_DB, like: 'ask-unknown-account' }),
    X('ask-email-with-a-nul-byte', 'POST ' + at('/ask'), 400, { body: { email: 'gh' + NUL + 'ost@x.com' }, setup: NUL_DB, like: 'ask-unknown-email' }),
    X('ask-shop-with-a-nul-byte', 'POST ' + at('/ask'), 400, { body: { id: 'ghost', shop: 'sh' + NUL + 'op' }, setup: NUL_DB, like: 'ask-unknown-account' }),
    /* verify */
    X('verify-nothing-typed', 'POST ' + at('/verify'), 400, { body: {} }),
    X('verify-code-too-short', 'POST ' + at('/verify'), 400, { body: { id: 'ghost', otp: '12' } }),
    X('verify-pin-not-four-digits', 'POST ' + at('/verify'), 400, { body: { id: 'ghost', pin: '12' } }),
    X('verify-unknown-account', 'POST ' + at('/verify'), 400, { body: { id: 'ghost', otp: '123456' } }),
    X('verify-unknown-email', 'POST ' + at('/verify'), 400, { body: { email: 'ghost@x.com', otp: '123456' } }),
    X('verify-unknown-user-id', 'POST ' + at('/verify'), 400, { body: { user_id: 'ghost', otp: '123456' } }),
    X('verify-two-businesses-of-one-name', 'POST ' + at('/verify'), 409, { body: { id: 'ravik@Tea Shop', otp: '123456' }, setup: { sqlRows: TWO_SHOPS } }),
    X('verify-device-removed', 'POST ' + at('/verify'), 403, { body: { email: 'a@x.com', otp: '123456' }, patch: refusing('DEVICE_REVOKED'), setup: KNOWN }),
    X('verify-session-not-listed', 'POST ' + at('/verify'), 503, { body: { email: 'a@x.com', otp: '123456' }, patch: refusing('SESSION_NOT_LISTED'), setup: KNOWN }),
    X('verify-db-fails', 'POST ' + at('/verify'), 500, { body: { id: 'ghost', otp: '123456' }, setup: FAILING }),
    X('verify-id-with-a-nul-byte', 'POST ' + at('/verify'), 400, { body: { id: 'gh' + NUL + 'ost', otp: '123456' }, setup: NUL_DB, like: 'verify-unknown-account' }),
    X('verify-email-with-a-nul-byte', 'POST ' + at('/verify'), 400, { body: { email: 'gh' + NUL + 'ost@x.com', otp: '123456' }, setup: NUL_DB, like: 'verify-unknown-email' }),
    X('verify-user-id-with-a-nul-byte', 'POST ' + at('/verify'), 400, { body: { user_id: 'gh' + NUL + 'ost', otp: '123456' }, setup: NUL_DB, like: 'verify-unknown-user-id' }),
    X('verify-shop-with-a-nul-byte', 'POST ' + at('/verify'), 400, { body: { id: 'ghost', otp: '123456', shop: 'sh' + NUL + 'op' }, setup: NUL_DB, like: 'verify-unknown-account' }),
    /* verify, the key@Display Name door */
    X('verify-actor-no-at-sign', 'POST ' + at('/verify'), 400, { body: { username: 'ravik', otp: '123456' } }),
    X('verify-actor-unknown', 'POST ' + at('/verify'), 400, { body: { username: 'ghost@shop-a', otp: '123456' } }),
    X('verify-actor-username-with-a-nul-byte', 'POST ' + at('/verify'), 400, { body: { username: 'gh' + NUL + 'ost@shop-a', otp: '123456' }, setup: NUL_DB, like: 'verify-actor-unknown' }),
    X('verify-actor-db-fails', 'POST ' + at('/verify'), 500, { body: { username: 'ghost@shop-a', otp: '123456' }, setup: FAILING }),
    /* pin */
    X('pin-too-short', 'POST ' + at('/pin'), 400, { body: { pin: '12', confirm_pin: '12' }, setup: { who: STAFF } }),
    X('pin-does-not-match', 'POST ' + at('/pin'), 400, { body: { pin: '1234', confirm_pin: '4321' }, setup: { who: STAFF } }),
    X('pin-by-an-owner', 'POST ' + at('/pin'), 400, { body: { pin: '1234', confirm_pin: '1234' }, setup: { who: OWNER } }),
    X('pin-db-fails', 'POST ' + at('/pin'), 500, { body: { pin: '1234', confirm_pin: '1234' }, setup: { who: STAFF, db: 'fail' } }),
    X('pin-set', 'POST ' + at('/pin'), 200, { body: { pin: '1234', confirm_pin: '1234' }, setup: { who: STAFF } })
  ];
}

module.exports = { extras, NUL };

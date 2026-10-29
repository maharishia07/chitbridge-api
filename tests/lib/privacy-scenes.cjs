/**
 * privacy-scenes.cjs — the named scenarios of tests/api-problem-privacy.test.cjs: an answer the generic worlds cannot reach (a shopper with rows, a consent given and withdrawn, a
 * request of each kind, a token with no shop, a library that throws).
 *
 * OWNS      the extras: one scenario per answer of routes/privacy.js worth freezing, with the stand-in rows it needs (the shop, the shopper, another shopper's rows that must never
 *           come back, the two b306/b307 tables present or not); and the PLACEHOLDER people. ⚠️ PERSONAL DATA: every name, phone and e-mail here is an obviously made-up placeholder
 *           (zeros, example.test), never a real-looking one.
 * CALLED BY tests/api-problem-privacy.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db, realAuth }, headers, patch, env, body, url, synthetic }] → the harness runs each one against the real route
 * CARD      11-crm-and-marketing/privacy-consent
 * A scenario with `synthetic: true` makes the library throw an error that carries a status no real library raises under these routes: it is replayed in a capture and a compare
 * (the pass-through is frozen), and checked on its own in a check run, where the contract declares no such status.
 * The stand-in sign-in of the harness gives a shopper with no shop; the line below gives it the shop it belongs to, as the real sign-in reads it from the token.
 */
'use strict';
const jwt = require('jsonwebtoken');
const { OWNER, CUSTOMER, sqlError, SECRET_SQL } = require('./problem-world.cjs');

const BASE = '/api/privacy';
const SHOP = OWNER.identity_id;
const SHOP_B = '99999999-9999-4999-8999-999999999999'; /* another shop */
const ME = CUSTOMER.identity_id; /* the shopper whose token it is */
const OTHER = '66666666-6666-4666-8666-666666666666'; /* another shopper of the same shop */
const OTHER_B = '88888888-8888-4888-8888-888888888888'; /* a shopper of another shop */
Object.assign(CUSTOMER, { shop_entity_id: SHOP });
const ME_ROW = { identity_id: ME, display_name: 'Test customer', phone: '0000000000', email: 'nobody@example.test', otp_contact: '0000000000', country: null };
const SHOP_ROW = { identity_id: SHOP, display_name: 'Test shop', phone: null, email: null, otp_contact: null, country: 'IN' };
/** another shopper's people and values: none of these may ever be in an answer of ME */
const OTHERS = { name: 'Other Person', phone: '+00 00000 00003', email: 'other@example.test', note: 'other-answer' };
const OTHER_ROW = { identity_id: OTHER, display_name: OTHERS.name, phone: OTHERS.phone, email: OTHERS.email, otp_contact: OTHERS.phone, country: null };
const RELAYED = 'A relayed sentence.';
const STAMP = '2026-10-01T00:00:00.000Z';
const DUE = '2999-01-01T00:00:00.000Z';

/** a made-up pref row (b306) and request row (b307) */
const prefRow = (owner, party, channel, purpose, allowed, basis, noted) => ({ pref_id: '20000000-0000-4000-8000-0000000000' + String(noted || 1).padStart(2, '0'), owner, party_id: party, channel, purpose, allowed, basis: basis || (purpose === 'marketing' ? 'consent' : 'legitimate_use'), notice_version: null, noted_at: STAMP, noted_by: party, withdrawn_at: null, source: null, source_ref: null });
const requestRow = (owner, party, kind, who, answer) => ({ request_id: '30000000-0000-4000-8000-000000000001', owner, party_id: party, who, kind, country: 'IN', received_at: STAMP, due_at: DUE, answered_at: null, outcome: null, answer: answer || null });

/**
 * the stand-in database for one scene (row security stand-in: a table is read only by the entity that owns the row, and only for the party asked)
 *   o.have      { party_contact_pref, privacy_request } false = the table is not migrated   · o.shop the shop's row (country)   · o.me the shopper's row (null = none)
 *   o.prefs / o.requests   rows of ANY owner and party; a read is filtered by its params, as the real statement is
 *   o.throwOn /pattern/ + o.error  the error thrown   · o.seen  an array told each statement and its params
 */
function world(o) {
  const opts = o || {};
  const have = Object.assign({ party_contact_pref: true, privacy_request: true }, opts.have);
  const shop = opts.shop === undefined ? SHOP_ROW : opts.shop;
  const me = opts.me === undefined ? ME_ROW : opts.me;
  const people = [shop, me, OTHER_ROW].filter(Boolean);
  const prefs = opts.prefs || [];
  const requests = opts.requests || [];
  return (sql, params) => {
    if (opts.seen) opts.seen.push({ sql, params });
    if (opts.throwOn && opts.throwOn.test(sql)) throw opts.error || new Error(SECRET_SQL);
    if (/to_regclass/.test(sql)) return { rows: [{ ok: have[params[0]] !== false }], rowCount: 1 };
    if (/FROM identities WHERE identity_id = ANY/.test(sql)) return { rows: people.filter((one) => params[0].includes(one.identity_id)), rowCount: 1 };
    if (/^SELECT display_name, phone, otp_contact, email FROM identities WHERE identity_id = \$1/.test(sql)) {
      const found = people.filter((one) => one.identity_id === params[0]);
      return { rows: found, rowCount: found.length };
    }
    if (/^SELECT country, display_name FROM identities WHERE identity_id = \$1/.test(sql)) {
      const found = people.filter((one) => one.identity_id === params[0]);
      return { rows: found, rowCount: found.length };
    }
    if (/FROM party_contact_pref\s+WHERE owner_entity_id = \$1 AND party_id = \$2/.test(sql)) {
      const found = prefs.filter((row) => row.owner === params[0] && row.party_id === params[1]).slice().reverse();
      return { rows: found, rowCount: found.length };
    }
    if (/^INSERT INTO party_contact_pref/.test(sql)) {
      const row = { pref_id: '20000000-0000-4000-8000-000000000099', channel: params[2], purpose: params[3], allowed: params[4], basis: params[5], notice_version: params[6], noted_at: STAMP, noted_by: params[7], withdrawn_at: /\$8, now\(\)/.test(sql) ? STAMP : null };
      return { rows: [row], rowCount: 1 };
    }
    if (/WITH c AS/.test(sql)) {
      const found = requests.filter((row) => row.owner === params[0] && (params.length < 4 || row.party_id === params[3]));
      const head = { total: found.length, n_open: found.length, n_late: 0 };
      return { rows: found.length ? found.map((row) => Object.assign({}, head, row)) : [Object.assign({ request_id: null }, head)], rowCount: 1 };
    }
    if (/^INSERT INTO privacy_request/.test(sql)) {
      const row = { request_id: '30000000-0000-4000-8000-000000000099', party_id: params[1], who: params[2], kind: params[3], country: params[4], received_at: params[5], due_at: params[6], answered_at: null, outcome: null, answer: null };
      return { rows: [row], rowCount: 1 };
    }
    return null;
  };
}

/** a made-up customer token (the real sign-in reads it): `shop` is the parent, `extra` more claims */
const token = (shop, extra) => 'Bearer ' + jwt.sign(Object.assign({ identity_id: ME, identity_type: 'customer' }, shop ? { parent_entity_id: shop } : {}, extra || {}), process.env.JWT_SECRET, { algorithm: 'HS256' });
const ownerToken = () => 'Bearer ' + jwt.sign({ identity_id: SHOP, identity_type: 'entity' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
const expiredToken = () => 'Bearer ' + jwt.sign({ identity_id: ME, identity_type: 'customer', parent_entity_id: SHOP }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: -60 });

/** one scene: the common shape */
const scene = (id, route, url, expectStatus, extra) => Object.assign({ id, route, url: BASE + url, expect: expectStatus }, extra || {});
/** a scene's setup: the stand-in database, signed in by the harness's stand-in shopper */
const asks = (o) => ({ db: 'ok', sqlRows: world(o) });
/** a scene's setup with the REAL sign-in: the token is read as the middleware reads it */
const real = (o) => Object.assign({ realAuth: true, db: 'ok', sqlRows: world(o) });

const HELD = { prefs: [prefRow(SHOP, ME, 'sms', 'marketing', true, 'consent', 1), prefRow(SHOP, ME, 'email', 'service', false, 'legitimate_use', 2)], requests: [requestRow(SHOP, ME, 'access', 'Test customer')] };
/** another shopper's and another shop's rows, which no answer of ME may carry */
const OTHERS_ROWS = { prefs: [prefRow(SHOP, OTHER, 'whatsapp', 'marketing', true, 'consent', 7), prefRow(SHOP_B, ME, 'phone', 'marketing', true, 'consent', 8)], requests: [requestRow(SHOP, OTHER, 'erase', OTHERS.name, OTHERS.note), requestRow(SHOP_B, ME, 'erase', 'Test customer', OTHERS.note)] };

function facts() {
  const F = 'GET ' + BASE + '/facts';
  return [
    scene('facts-default', F, '/facts', 200, { setup: asks({}) }),
    scene('facts-notice-and-contact', F, '/facts', 200, { setup: asks({}), env: { PRIVACY_NOTICE_VERSION: 'v0-test', PRIVACY_CONTACT: 'privacy@example.test' } }),
    scene('facts-every-provider-on', F, '/facts', 200, { setup: asks({}), env: { RESEND_API_KEY: 'not-a-key', WHATSAPP_TOKEN: 'not-a-key', ANTHROPIC_API_KEY: 'not-a-key', OPENAI_API_KEY: 'not-a-key', RAILWAY_REGION: 'test-region-1' } }),
    scene('facts-asked-with-a-query', F, '/facts?anything=1&anything=2', 200, { setup: asks({}) }),
    /* the library throws: this route has no catch of its own, so server.js's one error handler answers (the test app ends with the same call) */
    scene('facts-library-throws', F, '/facts', 500, { setup: asks({}), patch: { pv: { facts: () => { throw new Error(SECRET_SQL); } } } })
  ];
}

function reads() {
  const M = 'GET ' + BASE + '/me';
  const held = (o) => asks(Object.assign({}, HELD, o));
  const down = (o) => asks(Object.assign({}, HELD, o));
  return [
    scene('me-india', M, '/me', 200, { setup: held({}) }),
    scene('me-india-beside-others-rows', M, '/me', 200, { setup: held(OTHERS_ROWS) }),
    scene('me-nothing-given-yet', M, '/me', 200, { setup: asks({}) }),
    scene('me-australia', M, '/me', 200, { setup: held({ shop: Object.assign({}, SHOP_ROW, { country: 'au' }) }) }),
    scene('me-uae', M, '/me', 200, { setup: held({ shop: Object.assign({}, SHOP_ROW, { country: 'AE' }) }) }),
    scene('me-country-with-no-pack', M, '/me', 200, { setup: held({ shop: Object.assign({}, SHOP_ROW, { country: 'ZZ' }) }) }),
    scene('me-shop-has-no-country', M, '/me', 200, { setup: held({ shop: Object.assign({}, SHOP_ROW, { country: null }) }) }),
    scene('me-shopper-row-missing', M, '/me', 200, { setup: held({ me: null }) }),
    scene('me-nothing-migrated', M, '/me', 200, { setup: held({ have: { party_contact_pref: false, privacy_request: false } }) }),
    scene('me-consent-not-migrated', M, '/me', 200, { setup: held({ have: { party_contact_pref: false } }) }),
    scene('me-requests-not-migrated', M, '/me', 200, { setup: held({ have: { privacy_request: false } }) }),
    scene('me-real-sign-in', M, '/me', 200, { setup: real(HELD), headers: { authorization: token(SHOP, { display_name: 'Test customer' }) } }),
    scene('me-token-has-no-shop', M, '/me', 403, { setup: real(HELD), headers: { authorization: token(null) } }),
    scene('me-token-of-an-owner', M, '/me', 401, { setup: real(HELD), headers: { authorization: ownerToken() } }),
    scene('me-token-expired', M, '/me', 401, { setup: real(HELD), headers: { authorization: expiredToken() } }),
    scene('me-token-garbage', M, '/me', 401, { setup: real(HELD), headers: { authorization: 'Bearer not.a.token' } }),
    scene('me-identities-throw', M, '/me', 500, { setup: down({ throwOn: /FROM identities/ }) }),
    scene('me-identities-throw-code', M, '/me', 500, { setup: down({ throwOn: /FROM identities/, error: sqlError('42501') }) }),
    scene('me-consent-read-throws', M, '/me', 500, { setup: down({ throwOn: /FROM party_contact_pref/ }) }),
    scene('me-requests-read-throws', M, '/me', 500, { setup: down({ throwOn: /WITH c AS/ }) }),
    scene('me-table-check-throws', M, '/me', 500, { setup: down({ throwOn: /to_regclass/, error: sqlError('57P01') }) }),
    scene('me-answer-not-written', M, '/me', 500, { setup: Object.assign(held({}), { jsonThrows: true }) })
  ];
}

function consents() {
  const C = 'POST ' + BASE + '/me/consent';
  const give = (id, expectStatus, body, o, extra) => scene(id, C, '/me/consent', expectStatus, Object.assign({ body, setup: asks(Object.assign({}, HELD, o || {})) }, extra || {}));
  const yes = { channel: 'sms', purpose: 'marketing', allowed: true };
  return [
    give('consent-offers-yes', 201, yes),
    give('consent-offers-no', 201, { channel: 'sms', purpose: 'marketing', allowed: false }),
    give('consent-offers-withdrawn', 201, { channel: 'sms', purpose: 'marketing', allowed: false }),
    give('consent-service-no', 201, { channel: 'whatsapp', purpose: 'service', allowed: false }),
    give('consent-service-yes', 201, { channel: 'email', purpose: 'service', allowed: true }),
    give('consent-phone', 201, { channel: 'phone', purpose: 'marketing', allowed: true }),
    give('consent-chitbridge', 201, { channel: 'chitbridge', purpose: 'service', allowed: true }),
    give('consent-words-in-capitals', 201, { channel: 'EMAIL', purpose: 'Marketing', allowed: true }),
    give('consent-nothing-held-before', 201, yes, { prefs: [] }),
    give('consent-asked-to-name-others', 201, Object.assign({}, yes, { shop: SHOP_B, shop_entity_id: SHOP_B, owner_entity_id: SHOP_B, party_id: OTHER, identity_id: OTHER, noted_by: OTHER, basis: 'legitimate_use', source: 'staff', source_ref: 'x' }), OTHERS_ROWS),
    give('consent-unknown-channel', 400, { channel: 'pigeon', purpose: 'marketing', allowed: true }),
    give('consent-unknown-purpose', 400, { channel: 'sms', purpose: 'surveys', allowed: true }),
    give('consent-yes-as-text', 400, { channel: 'sms', purpose: 'marketing', allowed: 'true' }),
    give('consent-yes-as-number', 400, { channel: 'sms', purpose: 'marketing', allowed: 1 }),
    give('consent-yes-missing', 400, { channel: 'sms', purpose: 'marketing' }),
    give('consent-channel-missing', 400, { purpose: 'marketing', allowed: true }),
    give('consent-purpose-missing', 400, { channel: 'sms', allowed: true }),
    give('consent-channel-as-number', 400, { channel: 5, purpose: 'marketing', allowed: true }),
    give('consent-empty-body', 400, {}),
    give('consent-body-is-a-list', 400, []),
    give('consent-body-is-a-list-of-answers', 400, [yes]),
    give('consent-not-migrated', 503, yes, { have: { party_contact_pref: false } }),
    give('consent-real-sign-in', 201, yes, {}, { setup: real(HELD), headers: { authorization: token(SHOP) } }),
    give('consent-token-has-no-shop', 403, yes, {}, { setup: real(HELD), headers: { authorization: token(null) } }),
    give('consent-token-of-an-owner', 401, yes, {}, { setup: real(HELD), headers: { authorization: ownerToken() } }),
    give('consent-history-read-throws', 500, yes, { throwOn: /FROM party_contact_pref\s+WHERE/ }),
    give('consent-write-throws', 500, yes, { throwOn: /INSERT INTO party_contact_pref/ }),
    give('consent-write-throws-code', 500, yes, { throwOn: /INSERT INTO party_contact_pref/, error: sqlError('23514') }),
    give('consent-table-check-throws', 500, yes, { throwOn: /to_regclass/ }),
    give('consent-answer-not-written', 500, yes, {}, { setup: Object.assign(asks(HELD), { jsonThrows: true }) })
  ];
}

function filings() {
  const R = 'POST ' + BASE + '/me/requests';
  const file = (id, expectStatus, body, o, extra) => scene(id, R, '/me/requests', expectStatus, Object.assign({ body, setup: asks(Object.assign({}, HELD, o || {})) }, extra || {}));
  const nameless = (row) => ({ me: Object.assign({}, ME_ROW, row) });
  const signed = (row) => ({ setup: real(Object.assign({}, HELD, nameless(row))), headers: { authorization: token(SHOP) } });
  return [].concat(
    ['access', 'correct', 'erase', 'withdraw', 'nominate', 'grievance'].map((kind) => file('request-' + kind, 201, { kind })),
    [
      file('request-grievance-in-australia', 201, { kind: 'grievance' }, { shop: Object.assign({}, SHOP_ROW, { country: 'AU' }) }),
      file('request-access-in-the-uae', 201, { kind: 'access' }, { shop: Object.assign({}, SHOP_ROW, { country: 'AE' }) }),
      file('request-kind-in-capitals', 201, { kind: 'ERASE' }),
      file('request-asked-to-name-others', 201, { kind: 'access', who: OTHERS.name, party_id: OTHER, country: 'AU', received_at: '2000-01-01T00:00:00Z', owner_entity_id: SHOP_B, shop: SHOP_B, created_by: OTHER, answer: OTHERS.note }, OTHERS_ROWS),
      file('request-named-by-the-sign-in', 201, { kind: 'access' }),
      file('request-named-by-the-record', 201, { kind: 'access' }, nameless({ display_name: 'Record name' }), signed({ display_name: 'Record name' })),
      file('request-named-by-the-phone', 201, { kind: 'access' }, {}, signed({ display_name: null })),
      file('request-named-by-the-contact', 201, { kind: 'access' }, {}, signed({ display_name: null, phone: null })),
      file('request-named-by-the-email', 201, { kind: 'access' }, {}, signed({ display_name: null, phone: null, otp_contact: null })),
      file('request-named-by-nothing', 201, { kind: 'access' }, {}, signed({ display_name: null, phone: null, otp_contact: null, email: null })),
      file('request-shopper-row-missing', 201, { kind: 'access' }, { me: null }, { setup: real({ me: null }), headers: { authorization: token(SHOP) } }),
      file('request-unknown-kind', 400, { kind: 'complaint' }),
      file('request-kind-missing', 400, {}),
      file('request-kind-as-number', 400, { kind: 5 }),
      file('request-empty-body', 400, {}),
      file('request-body-is-a-list', 400, []),
      file('request-body-is-a-list-of-kinds', 400, [{ kind: 'access' }]),
      file('request-shop-has-no-country', 400, { kind: 'access' }, { shop: Object.assign({}, SHOP_ROW, { country: null }) }),
      file('request-not-migrated', 503, { kind: 'access' }, { have: { privacy_request: false } }),
      file('request-token-has-no-shop', 403, { kind: 'access' }, {}, { setup: real(HELD), headers: { authorization: token(null) } }),
      file('request-token-of-an-owner', 401, { kind: 'access' }, {}, { setup: real(HELD), headers: { authorization: ownerToken() } }),
      file('request-name-read-throws', 500, { kind: 'access' }, { throwOn: /^SELECT display_name, phone/ }),
      file('request-country-read-throws', 500, { kind: 'access' }, { throwOn: /^SELECT country, display_name/ }),
      file('request-write-throws', 500, { kind: 'access' }, { throwOn: /INSERT INTO privacy_request/ }),
      file('request-write-throws-code', 500, { kind: 'access' }, { throwOn: /INSERT INTO privacy_request/, error: sqlError('23502') }),
      file('request-table-check-throws', 500, { kind: 'access' }, { throwOn: /to_regclass/ }),
      file('request-answer-not-written', 500, { kind: 'access' }, {}, { setup: Object.assign(asks(HELD), { jsonThrows: true }) })
    ]
  );
}

/** a library under a route raises an error that carries a status: the route passes the status on under the old rule (a status below 500 relays its words; any other is the generic 500) */
function carried() {
  const throwing = (name, status, code, why) => ({ pv: { [name]: async () => { throw Object.assign(new Error(RELAYED), status === undefined ? {} : { status }, code ? { code } : {}, why ? { why } : {}); } } });
  const routes = [
    ['GET ' + BASE + '/me', '/me', undefined, 'shopper'],
    ['POST ' + BASE + '/me/consent', '/me/consent', { channel: 'sms', purpose: 'marketing', allowed: true }, 'notePref'],
    ['POST ' + BASE + '/me/requests', '/me/requests', { kind: 'access' }, 'logRequest']
  ];
  const modes = [
    ['thrown-400-with-code-and-why', 400, 'SOME_CODE', 'Because of this.', 400],
    ['thrown-403-no-code', 403, undefined, undefined, 403],
    ['thrown-404-no-code', 404, undefined, undefined, 404],
    ['thrown-409-with-code', 409, 'ANSWERED', undefined, 409],
    ['thrown-502', 502, undefined, undefined, 500],
    ['thrown-503-plain', 503, undefined, undefined, 500],
    ['thrown-503-not-migrated', 503, 'PRIVACY_NOT_MIGRATED', undefined, 503],
    ['thrown-no-status-not-migrated', undefined, 'PRIVACY_NOT_MIGRATED', undefined, 503],
    ['thrown-status-as-text', 'soon', undefined, undefined, 500],
    ['thrown-plain-error', undefined, undefined, undefined, 500]
  ];
  const found = [];
  routes.forEach(([route, url, body, name]) => modes.forEach(([id, status, code, why, expectStatus]) => found.push(scene(id, route, url, expectStatus, { body, patch: throwing(name, status, code, why), synthetic: true, says: RELAYED, setup: asks(HELD) }))));
  return found;
}

/** every named scene of the four routes */
function extras() {
  return [].concat(facts(), reads(), consents(), filings(), carried());
}

module.exports = { extras, world, asks, real, token, HELD, OTHERS_ROWS, OTHERS, ME, SHOP, SHOP_B, OTHER, OTHER_B, ME_ROW, SHOP_ROW, OTHER_ROW, RELAYED, STAMP, BASE, prefRow, requestRow };

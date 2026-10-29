/**
 * identity-docs-scenes.cjs — the named scenarios of tests/api-problem-identity-docs.test.cjs: an answer the generic worlds cannot reach (a seeded record, a refusal inside a
 * handler, a library that throws, a code that was asked for and then typed).
 *
 * OWNS      the extras: one scenario per answer of routes/identity-docs.js worth freezing, with the stand-in rows it needs (shop, country, co-assists, a stored record, a code
 *           that is pending); and the PLACEHOLDER values. ⚠️ PERSONAL DATA: every number here is an obviously made-up placeholder (all zeros / AAAAA0000A), never a real-looking one.
 * CALLED BY tests/api-problem-identity-docs.test.cjs. Not a test itself.
 * FLOW      extras(tools) → [{ id, route, expect, setup: { sqlRows, who, db }, patch, env, body, url, synthetic }] → the harness runs each one against the real route
 * CARD      18-identity-sign-in-and-access/README
 * A scenario with `synthetic: true` makes a library throw an error that carries a status no real library raises under these routes: it is replayed in a capture and a compare
 * (the status pass-through is frozen), and checked on its own in a check run, where the contract declares no such status.
 */
'use strict';
const path = require('path');
const { OWNER, STAFF, sqlError, SECRET_SQL } = require('./problem-world.cjs');

const BASE = '/api/identity';
const SHOP = OWNER.identity_id;
const ACTOR = '77777777-7777-4777-8777-777777777777'; /* one of the shop's co-assists */
const STRANGER_ACTOR = '88888888-8888-4888-8888-888888888888'; /* a co-assist of ANOTHER shop */
const VALUES = { PHONE: '0000000000', EMAIL: 'nobody@example.test', PAN: 'AAAAA0000A', VOTER_ID: 'AAA0000000', DL: 'AA-00-0000-0000', AADHAAR: '000000000000' };
const FIXED_CODE = '482910';
const TEN_MINUTES = 600000;
const STAMP = '2026-10-01T00:00:00.000Z';
const RELAYED = 'A relayed sentence.';

/** the vault the route stores through, with a made-up key (the test sets VAULT_ENC_KEY before it calls extras) */
const vault = () => require(path.join(__dirname, '..', '..', 'lib', 'vaultcrypto'));
const verify = () => require(path.join(__dirname, '..', '..', 'lib', 'iddoc-verify'));
const enc = (value) => JSON.stringify(vault().encryptVault({ v: value }));
/** a pending code for a person's scheme, packed the way lib/iddoc-verify.js keeps it: the code is FIXED_CODE */
const pending = (identity, scheme, tries, expiresIn) => verify().pack(FIXED_CODE, identity + ':' + scheme, Date.now() + (expiresIn === undefined ? TEN_MINUTES : expiresIn), tries || 0);

/**
 * the stand-in database for one scene: the table is there, the shop's country is given, a co-assist is looked up as row security would
 * (only the shop that owns the actor finds it), a stored record is found only by its owner and scheme, and a statement can be made to throw.
 *   o.country  the shop's country · o.docs the list rows · o.record { owner, scheme, value, status, ref } · o.throwOn /pattern/ + o.error the error thrown
 *   o.seen     an array that is told each statement and its params
 */
function world(o) {
  const opts = o || {};
  const actors = opts.actors || { [ACTOR]: SHOP };
  return (sql, params) => {
    if (opts.seen) opts.seen.push({ sql, params });
    if (opts.throwOn && opts.throwOn.test(sql)) throw opts.error || new Error(SECRET_SQL);
    if (/information_schema\.tables/.test(sql)) return opts.noTable ? { rows: [], rowCount: 0 } : { rows: [{ ok: 1 }], rowCount: 1 };
    if (/SELECT country FROM identities/.test(sql)) return { rows: [{ country: opts.country === undefined ? 'IN' : opts.country }], rowCount: 1 };
    if (/FROM identities WHERE identity_id = \$1 AND identity_type = 'actor'/.test(sql)) {
      const found = actors[params[0]] === params[1];
      return { rows: found ? [{ '?column?': 1 }] : [], rowCount: found ? 1 : 0 };
    }
    if (/SELECT scheme, country, value_masked/.test(sql)) return { rows: opts.docs || [], rowCount: (opts.docs || []).length };
    if (/SELECT value_enc, status, verification_ref/.test(sql)) {
      const r = opts.record;
      const hit = r && r.owner === params[0] && r.scheme === params[1];
      return hit ? { rows: [{ value_enc: r.value === null ? null : enc(r.value), status: r.status || 'pending', verification_ref: r.ref === undefined ? null : r.ref }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }
    if (/INSERT INTO identity_documents/.test(sql)) {
      return { rows: [{ scheme: params[3], value_masked: params[4], status: 'pending', submitted_by: params[7] }], rowCount: 1 };
    }
    if (/RETURNING verified_at/.test(sql)) return { rows: [{ verified_at: STAMP }], rowCount: 1 };
    if (/UPDATE identity_documents/.test(sql)) return { rows: [], rowCount: 1 };
    return null;
  };
}

const docRow = (scheme, status, stamp) => ({ scheme, country: 'IN', value_masked: 'XXXX', status, verified_at: stamp || null, verified_by: stamp ? 'otp:phone' : null, submitted_by: 'self', consent_at: null });
const GOT = [docRow('PHONE', 'verified', STAMP), docRow('PAN', 'pending')];

/** one scene: the common shape */
const scene = (id, route, url, expectStatus, extra) => Object.assign({ id, route, url: BASE + url, expect: expectStatus }, extra || {});
/** a scene's setup: who asks, and the stand-in database */
const asks = (who, o) => ({ who, db: 'ok', sqlRows: world(o) });

function reads(tools) {
  const G = 'GET ' + BASE + '/documents';
  const down = (o) => asks(OWNER, Object.assign({ throwOn: /SELECT scheme, country, value_masked/ }, o));
  return [
    scene('list-india', G, '/documents', 200, { setup: asks(OWNER, { docs: GOT }) }),
    scene('list-no-documents', G, '/documents', 200, { setup: asks(OWNER, {}) }),
    scene('list-australia', G, '/documents', 200, { setup: asks(OWNER, { docs: GOT, country: 'AU' }) }),
    scene('list-no-country', G, '/documents', 200, { setup: asks(OWNER, { docs: GOT, country: '' }) }),
    scene('list-page', G, '/documents?limit=1&page=2', 200, { setup: asks(OWNER, { docs: GOT }) }),
    scene('list-staff', G, '/documents', 200, { setup: asks(STAFF, { docs: GOT }) }),
    scene('list-for-co-assist', G, '/documents?identity_id=' + ACTOR, 200, { setup: asks(OWNER, { docs: GOT }) }),
    scene('list-own-id-named', G, '/documents?identity_id=' + SHOP, 200, { setup: asks(OWNER, { docs: GOT }) }),
    scene('list-stranger-named', G, '/documents?identity_id=' + STRANGER_ACTOR, 403, { setup: asks(OWNER, { docs: GOT }) }),
    scene('list-staff-names-other', G, '/documents?identity_id=' + ACTOR, 403, { setup: asks(STAFF, { docs: GOT }) }),
    scene('list-db-throws', G, '/documents', 500, { setup: down({}) }),
    scene('list-db-throws-code', G, '/documents', 500, { setup: down({ error: sqlError('42501') }) }),
    scene('list-country-throws', G, '/documents', 500, { setup: asks(OWNER, { throwOn: /SELECT country FROM identities/ }) }),
    scene('list-answer-not-written', G, '/documents', 500, { setup: Object.assign(asks(OWNER, { docs: GOT }), { jsonThrows: true }) })
  ];
}

/** the PUT: one made-up value per scheme, the refusals, a co-assist's Aadhaar */
function writes(tools) {
  const P = 'PUT ' + BASE + '/documents/:scheme';
  const put = (id, scheme, expectStatus, body, setup, extra) => scene(id, P, '/documents/' + scheme, expectStatus, Object.assign({ body, setup }, extra || {}));
  const ok = (who, o) => asks(who || OWNER, o);
  return [
    put('put-phone', 'PHONE', 200, { value: VALUES.PHONE }, ok()),
    put('put-phone-plus-spaces', 'phone', 200, { value: ' +00 0000-0000 ' }, ok()),
    put('put-phone-as-number', 'PHONE', 200, { value: 10000000000 }, ok()),
    put('put-email', 'EMAIL', 200, { value: ' Nobody@Example.TEST ' }, ok()),
    put('put-pan', 'PAN', 200, { value: 'aaaaa 0000-a' }, ok()),
    put('put-voter', 'VOTER_ID', 200, { value: VALUES.VOTER_ID }, ok()),
    put('put-licence', 'DL', 200, { value: VALUES.DL }, ok()),
    put('put-aadhaar-own', 'AADHAAR', 200, { value: VALUES.AADHAAR }, ok()),
    put('put-staff-phone', 'PHONE', 200, { value: VALUES.PHONE }, ok(STAFF)),
    put('put-staff-pan', 'PAN', 403, { value: VALUES.PAN }, ok(STAFF)),
    put('put-for-co-assist', 'PAN', 200, { value: VALUES.PAN, identity_id: ACTOR }, ok()),
    put('put-aadhaar-for-co-assist-no-consent', 'AADHAAR', 400, { value: VALUES.AADHAAR, identity_id: ACTOR }, ok()),
    put('put-aadhaar-for-co-assist-consent-true', 'AADHAAR', 200, { value: VALUES.AADHAAR, identity_id: ACTOR, consent: true }, ok()),
    put('put-aadhaar-for-co-assist-consent-text', 'AADHAAR', 200, { value: VALUES.AADHAAR, identity_id: ACTOR, consent: 'true' }, ok()),
    put('put-aadhaar-for-co-assist-consent-yes', 'AADHAAR', 400, { value: VALUES.AADHAAR, identity_id: ACTOR, consent: 'yes' }, ok()),
    put('put-for-stranger', 'PAN', 403, { value: VALUES.PAN, identity_id: STRANGER_ACTOR }, ok()),
    put('put-staff-for-colleague', 'PHONE', 403, { value: VALUES.PHONE, identity_id: ACTOR }, ok(STAFF)),
    put('put-unknown-scheme', 'PASSPORT', 400, { value: VALUES.PAN }, ok()),
    put('put-pan-in-australia', 'PAN', 400, { value: VALUES.PAN }, ok(OWNER, { country: 'AU' })),
    put('put-phone-in-australia', 'PHONE', 200, { value: VALUES.PHONE }, ok(OWNER, { country: 'AU' })),
    put('put-no-country', 'PAN', 400, { value: VALUES.PAN }, ok(OWNER, { country: '' })),
    put('put-bad-pan', 'PAN', 400, { value: '0000000000' }, ok()),
    put('put-no-value', 'PAN', 400, {}, ok()),
    put('put-value-object', 'PHONE', 400, { value: { number: VALUES.PHONE } }, ok()),
    put('put-body-is-a-list', 'PHONE', 400, [VALUES.PHONE], ok()),
    put('put-vault-unconfigured', 'PHONE', 503, { value: VALUES.PHONE }, ok(OWNER, {}), { env: { VAULT_ENC_KEY: '' } }),
    put('put-aadhaar-vault-unconfigured', 'AADHAAR', 503, { value: VALUES.AADHAAR }, ok(OWNER, {}), { env: { VAULT_ENC_KEY: '' } }),
    put('put-not-migrated', 'PHONE', 503, { value: VALUES.PHONE }, ok(OWNER, { noTable: true })),
    put('put-db-throws', 'PHONE', 500, { value: VALUES.PHONE }, ok(OWNER, { throwOn: /INSERT INTO identity_documents/ })),
    put('put-db-throws-code', 'PHONE', 500, { value: VALUES.PHONE }, ok(OWNER, { throwOn: /INSERT INTO identity_documents/, error: sqlError('23514') })),
    put('put-country-throws', 'PHONE', 500, { value: VALUES.PHONE }, ok(OWNER, { throwOn: /SELECT country FROM identities/ })),
    put('put-co-assist-lookup-throws', 'PAN', 500, { value: VALUES.PAN, identity_id: ACTOR }, ok(OWNER, { throwOn: /identity_type = 'actor'/ })),
    put('put-answer-not-written', 'PHONE', 500, { value: VALUES.PHONE }, Object.assign(ok(), { jsonThrows: true }))
  ];
}

/** POST /code: a code is asked for. The sender is made to answer by a patch; nothing is sent anywhere. */
function codes(tools) {
  const C = 'POST ' + BASE + '/documents/:scheme/code';
  const code = (id, scheme, expectStatus, o, extra) => {
    const options = o || {};
    const record = options.record === undefined ? { owner: SHOP, scheme, value: VALUES[scheme] === undefined ? '0' : VALUES[scheme] } : options.record;
    return scene(id, C, '/documents/' + scheme + '/code', expectStatus, Object.assign({ body: options.body || {}, setup: asks(options.who || OWNER, Object.assign({ record }, options.db || {})) }, extra || {}));
  };
  const delivered = { notify: { sendOtpSms: async () => ({ delivered: true }), sendOtpEmail: async () => ({ delivered: true }) } };
  const sealed = { NODE_ENV: 'production' };
  return [
    code('code-phone-not-sent', 'PHONE', 200),
    code('code-phone-sent', 'PHONE', 200, {}, { patch: delivered }),
    code('code-email-sent', 'EMAIL', 200, {}, { patch: delivered }),
    code('code-phone-sender-throws', 'PHONE', 200, {}, { patch: { notify: { sendOtpSms: async () => { throw new Error(SECRET_SQL); } } } }),
    code('code-email-sender-throws', 'EMAIL', 200, {}, { patch: { notify: { sendOtpEmail: async () => { throw new Error(SECRET_SQL); } } } }),
    code('code-for-co-assist', 'PHONE', 200, { body: { identity_id: ACTOR }, record: { owner: ACTOR, scheme: 'PHONE', value: VALUES.PHONE } }, { patch: delivered }),
    code('code-co-assist-named-in-query', 'PHONE', 200, { record: { owner: ACTOR, scheme: 'PHONE', value: VALUES.PHONE } }, { url: BASE + '/documents/PHONE/code?identity_id=' + ACTOR, patch: delivered }),
    code('code-pan-not-by-code', 'PAN', 400),
    code('code-aadhaar-not-by-code', 'AADHAAR', 400),
    code('code-unknown-scheme-no-row', 'PASSPORT', 404, { record: null }),
    code('code-no-row', 'PHONE', 404, { record: null }),
    code('code-value-unreadable', 'PHONE', 409, { record: { owner: SHOP, scheme: 'PHONE', value: null } }),
    code('code-phone-sealed', 'PHONE', 503, {}, { env: sealed }),
    code('code-email-sealed', 'EMAIL', 503, {}, { env: sealed }),
    code('code-not-migrated', 'PHONE', 503, { db: { noTable: true } }),
    code('code-stranger-named', 'PHONE', 403, { body: { identity_id: STRANGER_ACTOR } }),
    code('code-staff-names-colleague', 'PHONE', 403, { who: STAFF, body: { identity_id: ACTOR } }),
    code('code-staff-own', 'PHONE', 200, { who: STAFF, record: { owner: STAFF.identity_id, scheme: 'PHONE', value: VALUES.PHONE } }, { patch: delivered }),
    code('code-read-throws', 'PHONE', 500, { db: { throwOn: /SELECT value_enc, status, verification_ref/ } }),
    code('code-read-throws-code', 'PHONE', 500, { db: { throwOn: /SELECT value_enc, status, verification_ref/, error: sqlError('42501') } }),
    code('code-save-throws', 'PHONE', 500, { db: { throwOn: /UPDATE identity_documents/ } }, { patch: delivered }),
    code('code-answer-not-written', 'PHONE', 500, {}, { patch: delivered, setup: Object.assign(asks(OWNER, { record: { owner: SHOP, scheme: 'PHONE', value: VALUES.PHONE } }), { jsonThrows: true }) })
  ];
}

/** POST /verify: a code is typed. The pending code is FIXED_CODE, packed with a known expiry and wrong-attempt count. */
function confirms(tools) {
  const V = 'POST ' + BASE + '/documents/:scheme/verify';
  const verifyScene = (id, scheme, expectStatus, o, extra) => {
    const options = o || {};
    const ref = options.ref === undefined ? pending(options.owner || SHOP, scheme, options.tries, options.expiresIn) : options.ref;
    const record = options.record === undefined ? { owner: options.owner || SHOP, scheme, value: VALUES[scheme] || '0', ref } : options.record;
    return scene(id, V, '/documents/' + scheme + '/verify', expectStatus, Object.assign({ body: options.body === undefined ? { code: FIXED_CODE } : options.body, setup: asks(options.who || OWNER, Object.assign({ record }, options.db || {})) }, extra || {}));
  };
  return [
    verifyScene('verify-phone', 'PHONE', 200),
    verifyScene('verify-email', 'EMAIL', 200),
    verifyScene('verify-code-as-number', 'PHONE', 200, { body: { code: Number(FIXED_CODE) } }),
    verifyScene('verify-code-with-spaces', 'PHONE', 200, { body: { code: ' ' + FIXED_CODE + ' ' } }),
    verifyScene('verify-for-co-assist', 'PHONE', 200, { owner: ACTOR, body: { code: FIXED_CODE, identity_id: ACTOR } }),
    verifyScene('verify-wrong-code', 'PHONE', 400, { body: { code: '000000' } }),
    verifyScene('verify-wrong-code-one-left', 'PHONE', 400, { body: { code: '000000' }, tries: 3 }),
    verifyScene('verify-wrong-code-last', 'PHONE', 429, { body: { code: '000000' }, tries: 4 }),
    verifyScene('verify-locked', 'PHONE', 429, { tries: 5 }),
    verifyScene('verify-no-code-typed', 'PHONE', 400, { body: {} }),
    verifyScene('verify-expired', 'PHONE', 400, { expiresIn: -1000 }),
    verifyScene('verify-no-code-asked', 'PHONE', 400, { ref: null }),
    verifyScene('verify-pan-no-code-asked', 'PAN', 400, { ref: null }),
    verifyScene('verify-no-row', 'PHONE', 404, { record: null }),
    verifyScene('verify-not-migrated', 'PHONE', 503, { db: { noTable: true } }),
    verifyScene('verify-stranger-named', 'PHONE', 403, { body: { code: FIXED_CODE, identity_id: STRANGER_ACTOR } }),
    verifyScene('verify-staff-names-colleague', 'PHONE', 403, { who: STAFF, body: { code: FIXED_CODE, identity_id: ACTOR } }),
    verifyScene('verify-read-throws', 'PHONE', 500, { db: { throwOn: /SELECT value_enc, status, verification_ref/ } }),
    verifyScene('verify-stamp-throws', 'PHONE', 500, { db: { throwOn: /RETURNING verified_at/ } }),
    verifyScene('verify-stamp-throws-code', 'PHONE', 500, { db: { throwOn: /RETURNING verified_at/, error: sqlError('40001') } }),
    verifyScene('verify-wrong-count-save-throws', 'PHONE', 500, { body: { code: '000000' }, db: { throwOn: /UPDATE identity_documents SET verification_ref/ } })
  ];
}

/** a library under a route raises an error that carries a status: the route passes the status on and relays its words (frozen). One scene per route and per status. */
function carried() {
  const throwing = (status, code) => ({ schema: { hasTable: async () => { throw Object.assign(new Error(RELAYED), { status }, code ? { code } : {}); } } });
  const routes = [['GET', '/documents', undefined], ['PUT', '/documents/PHONE', { value: VALUES.PHONE }], ['POST', '/documents/PHONE/code', {}], ['POST', '/documents/PHONE/verify', { code: FIXED_CODE }]];
  const template = { GET: 'GET ' + BASE + '/documents', PUT: 'PUT ' + BASE + '/documents/:scheme', code: 'POST ' + BASE + '/documents/:scheme/code', verify: 'POST ' + BASE + '/documents/:scheme/verify' };
  const keyOf = (method, url) => (method === 'GET' ? template.GET : method === 'PUT' ? template.PUT : url.endsWith('/code') ? template.code : template.verify);
  const found = [];
  routes.forEach(([method, url, body]) => {
    [502, 503].forEach((status) => found.push(scene('thrown-' + status, keyOf(method, url), url, status, { body, patch: throwing(status), synthetic: true, says: RELAYED })));
  });
  /* the PUT only: a thrown 503 that carries a code of its own, as vaultcrypto.encryptVault raises one */
  found.push(scene('thrown-503-with-code', 'PUT ' + BASE + '/documents/:scheme', '/documents/PHONE', 503, { body: { value: VALUES.PHONE }, patch: throwing(503, 'VAULT_ENC_UNCONFIGURED'), synthetic: true, says: RELAYED }));
  found.push(scene('thrown-409-with-unregistered-code', 'GET ' + BASE + '/documents', '/documents', 409, { patch: throwing(409, 'SOMETHING_ELSE'), synthetic: true, says: RELAYED }));
  return found;
}

/** every named scene of the four routes */
function extras(tools) {
  return [].concat(reads(tools), writes(tools), codes(tools), confirms(tools), carried());
}

module.exports = { extras, world, asks, VALUES, ACTOR, STRANGER_ACTOR, SHOP, FIXED_CODE, RELAYED, STAMP, GOT, pending, enc, BASE };

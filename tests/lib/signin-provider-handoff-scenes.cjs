// OWNS      section F of tests/signin-provider.test.cjs: the P1a hand-off door (POST /api/signin/provider/handoff) against the same stand-in provider and in-memory doors
// CALLED BY tests/signin-provider.test.cjs (sectionD hands its helpers over; split out so that file does not grow past its size baseline)
'use strict';
module.exports = async function sectionF({ assert, crypto, http, apiBase, issuer, roundTrip, claimsOf, world, resetWorld, logLines, fragment, rawGet, expectRefused, DEVICE, checkAsync }) {
  /* ═══ F · the hand-off door (P1a): the one-time code → the SAME session the code door issues ═══ */
  console.log('F · POST /provider/handoff (P1a)');
  const identityAuth = require('../../lib/identity-auth');
  const eventsLib = require('../../lib/signin-events');
  const realAuth = { rowsOfCandidates: identityAuth.rowsOfCandidates, issueToken: identityAuth.issueToken };
  const provider = require('../../lib/signin-provider');
  const policy = require('../../lib/policy');
  const realPolicyGet = policy.get;
  let shopFlags = { signin_providers: ['google', 'microsoft'] }; // the shop's own switch (GOV flag signin_providers)
  policy.get = async () => { if (shopFlags instanceof Error) throw shopFlags; return shopFlags; };
  const realRecord = eventsLib.record;
  const written = [];
  const issued = [];
  const IDENTITY = { identity_id: 'aaaaaaaa-0000-4000-8000-000000000001', bridge_id: 'B1', display_name: 'Ravi Stores', email: 'ravi@firm.test', user_id: 'ravi', identity_type: 'entity', status: 'active', parent_entity_id: null, owner_scope: 'entity' };
  let account = IDENTITY;
  identityAuth.rowsOfCandidates = async () => (account ? [account] : []);
  identityAuth.issueToken = async (q, identity, opts) => {
    if (opts && opts.device_id === 'device-revoked') throw Object.assign(new Error('revoked'), { code: 'DEVICE_REVOKED' });
    issued.push({ identity: identity.identity_id, device: opts && opts.device_id });
    return 'stub-session-token-for-' + identity.identity_id;
  };
  eventsLib.record = (ev) => { written.push(ev); return Promise.resolve({ written: true }); };
  const post = (body, headers) =>
    new Promise((resolve, reject) => {
      const data = JSON.stringify(body);
      const req = http.request(apiBase + '/api/signin/provider/handoff', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, headers || {}) }, (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text, json: (() => { try { return JSON.parse(text); } catch (e) { return null; } })() }));
      });
      req.on('error', reject);
      req.end(data);
    });
  const codeOf = (res) => new URLSearchParams(fragment(res)).get('h');
  const linkFor = (identity, extra) => Object.assign({ provider: 'google', issuer, tenant: '', subject: 'g-sub-1', link_id: 'bbbbbbbb-0000-4000-8000-000000000001', identity_id: identity.identity_id, entity_id: identity.identity_id }, extra);
  const reset2 = () => { shopFlags = { signin_providers: ['google', 'microsoft'] }; provider._connectBuilt(true); resetWorld(); written.length = 0; issued.length = 0; account = IDENTITY; };
  const dev = { 'x-device-id': DEVICE };

  await checkAsync('F1 a valid ID token for a LINKED account with a VERIFIED e-mail gives the code door\'s own session body; the address held only a code; the code is single use', async () => {
    reset2();
    world.links.push(linkFor(IDENTITY));
    const r = await roundTrip({ tamper: claimsOf() });
    assert.ok(!/stub-session|token/i.test(r.callback.headers.location), 'no session in the address');
    const code = codeOf(r.callback);
    const ok = await post({ code }, dev);
    assert.strictEqual(ok.status, 200, ok.body);
    assert.strictEqual(ok.headers['cache-control'], 'no-store');
    assert.deepStrictEqual(Object.keys(ok.json).sort(), ['constitution', 'entity', 'identity', 'message', 'token'], 'the keys POST /verify answers');
    assert.strictEqual(ok.json.token, 'stub-session-token-for-' + IDENTITY.identity_id);
    assert.strictEqual(ok.json.identity.identity_id, IDENTITY.identity_id);
    assert.deepStrictEqual(issued, [{ identity: IDENTITY.identity_id, device: DEVICE }], 'the ONE session writer, with this device');
    assert.strictEqual(written.length, 1);
    assert.strictEqual(written[0].action, 'in');
    assert.strictEqual(written[0].method, 'google');
    assert.ok(/^[0-9a-f]{64}$/.test(written[0].subject_hash) && !JSON.stringify(written[0]).includes('g-sub-1'), 'the subject only as a keyed hash');
    const again = await post({ code }, dev);
    assert.strictEqual(again.status, 401);
    assert.strictEqual(again.json.code, 'SSO_HANDOFF');
    assert.strictEqual(issued.length, 1, 'a replayed code opens nothing');
    reset2();
  });
  await checkAsync('F2 an UNVERIFIED e-mail is refused in words, even for a linked subject; no session', async () => {
    reset2();
    world.links.push(linkFor(IDENTITY));
    const r = await roundTrip({ tamper: claimsOf({ email_verified: false }) });
    const res = await post({ code: codeOf(r.callback) }, dev);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.json.code, 'SSO_EMAIL_UNVERIFIED');
    assert.ok(/code we send you/.test(res.json.detail));
    assert.strictEqual(issued.length, 0);
    reset2();
  });
  await checkAsync('F3 an UNLINKED account is refused with the sentence that points at the code sign-in; nobody is created, nobody is found by e-mail', async () => {
    reset2();
    const r = await roundTrip({ tamper: claimsOf() }); // no link row: the e-mail is on file at the identity, and must not matter
    const res = await post({ code: codeOf(r.callback) }, dev);
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.json.code, 'SSO_NOT_LINKED');
    assert.ok(/mobile number or e-mail and the code/.test(res.json.detail));
    assert.strictEqual(issued.length, 0);
    assert.ok(!world.queries.some((sql) => /INSERT|identities/i.test(sql)), 'no account is read or written by e-mail, none is created');
    reset2();
  });
  await checkAsync('F4 a bad nonce, a replayed callback and alg none never reach a hand-off code: the callback refuses, and a made-up code opens nothing', async () => {
    reset2();
    world.links.push(linkFor(IDENTITY));
    const nonce = await roundTrip({ tamper: (token) => { claimsOf()(token); token.payload.nonce = 'a-nonce-we-never-sent'; } });
    expectRefused(nonce.callback, 'SSO_TOKEN');
    const replay = await roundTrip({ tamper: claimsOf() });
    assert.ok(codeOf(replay.callback));
    const second = await rawGet(replay.callbackUrl, replay.cookieHeader);
    expectRefused(second, 'SSO_STATE');
    const forgedCode = await post({ code: crypto.randomBytes(32).toString('base64url') }, dev);
    assert.strictEqual(forgedCode.status, 401);
    assert.strictEqual(issued.length, 0);
    reset2();
  });
  await checkAsync('F5 a code used from ANOTHER device is as dead as a spent one; no device id is a 400 before anything is read', async () => {
    reset2();
    world.links.push(linkFor(IDENTITY));
    const r = await roundTrip({ tamper: claimsOf() });
    const code = codeOf(r.callback);
    const none = await post({ code }, {});
    assert.strictEqual(none.status, 400);
    assert.strictEqual(none.json.code, 'NO_DEVICE');
    const other = await post({ code }, { 'x-device-id': 'device-someone-else' });
    assert.strictEqual(other.status, 401);
    assert.strictEqual(other.json.code, 'SSO_HANDOFF');
    const mine = await post({ code }, dev);
    assert.strictEqual(mine.status, 401, 'the other device spent it');
    assert.strictEqual(issued.length, 0);
    reset2();
  });
  await checkAsync('F6 two linked accounts → asked to use the code sign-in; an ended account, another shop\'s link and a removed device are each refused in words', async () => {
    reset2();
    const second = Object.assign({}, IDENTITY, { identity_id: 'aaaaaaaa-0000-4000-8000-000000000002' });
    world.links.push(linkFor(IDENTITY), linkFor(second, { link_id: 'bbbbbbbb-0000-4000-8000-000000000002' }));
    let res = await post({ code: codeOf((await roundTrip({ tamper: claimsOf() })).callback) }, dev);
    assert.deepStrictEqual([res.status, res.json.code], [409, 'SSO_MANY']);
    reset2();
    world.links.push(linkFor(IDENTITY));
    account = Object.assign({}, IDENTITY, { status: 'closed' });
    res = await post({ code: codeOf((await roundTrip({ tamper: claimsOf() })).callback) }, dev);
    assert.deepStrictEqual([res.status, res.json.code], [403, 'SIGNIN_REFUSED']);
    reset2();
    world.links.push(linkFor(IDENTITY, { entity_id: 'cccccccc-0000-4000-8000-000000000009' }));
    res = await post({ code: codeOf((await roundTrip({ tamper: claimsOf() })).callback) }, dev);
    assert.deepStrictEqual([res.status, res.json.code], [403, 'SIGNIN_REFUSED']);
    reset2();
    world.links.push(linkFor(IDENTITY));
    res = await post({ code: codeOf((await roundTrip({ tamper: claimsOf(), device: 'device-revoked' })).callback) }, { 'x-device-id': 'device-revoked' });
    assert.deepStrictEqual([res.status, res.json.code], [403, 'DEVICE_REVOKED']);
    assert.strictEqual(issued.length, 0, 'the writer refused: nothing was opened');
    reset2();
  });
  await checkAsync('F7 the per-account budget stops a flood: the sixth sign-in for one account in the window is a 429 RATE_LIMITED', async () => {
    reset2();
    const who = Object.assign({}, IDENTITY, { identity_id: 'aaaaaaaa-0000-4000-8000-0000000000f7' });
    account = who;
    world.links.push(linkFor(who));
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await post({ code: codeOf((await roundTrip({ tamper: claimsOf() })).callback) }, dev)).status);
    assert.deepStrictEqual(statuses, [200, 200, 200, 200, 200, 429]);
    reset2();
  });
  await checkAsync('F8 nothing secret in a log line or an address: no session token, no hand-off code, no ID token', async () => {
    reset2();
    const who = Object.assign({}, IDENTITY, { identity_id: 'aaaaaaaa-0000-4000-8000-0000000000f8' });
    account = who;
    world.links.push(linkFor(who));
    const r = await roundTrip({ tamper: claimsOf() });
    const code = codeOf(r.callback);
    const ok = await post({ code }, dev);
    assert.strictEqual(ok.status, 200, ok.body);
    const everything = logLines.join('\n') + JSON.stringify(written);
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}\./.test(everything), 'no JWT');
    assert.ok(!everything.includes(ok.json.token), "no session token in a log or an audit row");
    assert.ok(!everything.includes(code), "no hand-off code in a log or an audit row");
    assert.ok(!r.callback.headers.location.includes(ok.json.token) && !/[?&](token|access_token|id_token)=/.test(r.callback.headers.location), "the address holds the one-time code only, never the session, and never in a query");
    reset2();
  });
  await checkAsync('F9 GET /providers says live:true (config present and the door is built) so the page may turn the button on', async () => {
    reset2();
    const body = JSON.parse((await rawGet(apiBase + '/api/signin/providers')).body);
    assert.ok(body.providers.length > 0 && body.providers.every((p) => p.live === true));
    reset2();
  });
  await checkAsync('H2 a provider is live:false while the connect step is not built: the button stays grey', async () => {
    reset2();
    provider._connectBuilt(false);
    const body = JSON.parse((await rawGet(apiBase + '/api/signin/providers')).body);
    assert.ok(body.providers.length > 0 && body.providers.every((p) => p.live === false), JSON.stringify(body));
    reset2();
  });
  await checkAsync('M1 the shop switched Google off: a linked person is refused (403 SIGNIN_PROVIDER_NOT_ACCEPTED), no session; a fault reading the switch is a 503, not "not switched on" (M3)', async () => {
    reset2();
    world.links.push(linkFor(IDENTITY));
    shopFlags = { signin_providers: ['microsoft'] };
    let res = await post({ code: codeOf((await roundTrip({ tamper: claimsOf() })).callback) }, dev);
    assert.deepStrictEqual([res.status, res.json.code], [403, 'SIGNIN_PROVIDER_NOT_ACCEPTED']);
    assert.strictEqual(issued.length, 0);
    shopFlags = new Error('database down');
    res = await post({ code: codeOf((await roundTrip({ tamper: claimsOf() })).callback) }, dev);
    assert.deepStrictEqual([res.status, res.json.code], [503, 'SIGNIN_UNAVAILABLE']);
    assert.ok(/Start again from the sign-in page/.test(res.json.detail) && !/switched on/.test(res.json.detail));
    reset2();
  });
  await checkAsync('M2 one device read: a header and a body that disagree are refused (400 DEVICE_MISMATCH) and nothing is opened; the same id twice is fine', async () => {
    reset2();
    world.links.push(linkFor(IDENTITY));
    const code = codeOf((await roundTrip({ tamper: claimsOf() })).callback);
    let res = await post({ code, device_id: 'device-other-0002' }, dev);
    assert.deepStrictEqual([res.status, res.json.code], [400, 'DEVICE_MISMATCH']);
    assert.strictEqual(issued.length, 0);
    res = await post({ code: codeOf((await roundTrip({ tamper: claimsOf() })).callback), device_id: DEVICE }, dev);
    assert.strictEqual(res.status, 200, res.body);
    assert.strictEqual(issued[0].device, DEVICE, 'the session is listed under the device the check used');
    reset2();
  });
  await checkAsync('L1 an unlink inside the 60 seconds revokes the outstanding code: the link is read again at the swap', async () => {
    reset2();
    world.links.push(linkFor(IDENTITY));
    const code = codeOf((await roundTrip({ tamper: claimsOf() })).callback);
    world.links.length = 0; // the person unlinked after the callback
    const res = await post({ code }, dev);
    assert.deepStrictEqual([res.status, res.json.code], [403, 'SSO_NOT_LINKED']);
    assert.strictEqual(issued.length, 0);
    reset2();
  });
  Object.assign(identityAuth, realAuth);
  policy.get = realPolicyGet;
  eventsLib.record = realRecord;

};

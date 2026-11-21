// OWNS      section G of tests/signin-provider.test.cjs: the CONNECT step (critic 21 Nov): link start with re-proof, subject binding, the callback's link write, list, unlink, audit, no secret in a log
// CALLED BY tests/signin-provider.test.cjs (same stand-in provider and in-memory doors; middleware/auth is a test seam: header x-test-as names the person)
'use strict';
module.exports = async function sectionG({ assert, crypto, http, apiBase, issuer, roundTrip, claimsOf, world, resetWorld, logLines, fragment, rawGet, DEVICE, checkAsync }) {
  console.log('G · connect: link start, callback link, list, unlink (P1a)');
  const identityAuth = require('../../lib/identity-auth');
  const eventsLib = require('../../lib/signin-events');
  const policy = require('../../lib/policy');
  const provider = require('../../lib/signin-provider');
  const real = { rowsOfCandidates: identityAuth.rowsOfCandidates, verifyCredential: identityAuth.verifyCredential, record: eventsLib.record, get: policy.get };
  const written = [];
  const SHOP = 'aaaaaaaa-0000-4000-8000-0000000000a1';
  const PERSON = { identity_id: SHOP, bridge_id: 'B9', display_name: 'Meena Stores', email: 'meena@shop.test', user_id: 'meena', identity_type: 'entity', status: 'active', parent_entity_id: null, pin_hash: 'x' };
  const STAFF = { identity_id: 'aaaaaaaa-0000-4000-8000-0000000000a2', bridge_id: 'B9', display_name: 'Asha', email: 'asha@shop.test', user_id: 'asha', identity_type: 'actor', status: 'active', parent_entity_id: SHOP, pin_hash: 'x' };
  const NOWAY = { identity_id: 'aaaaaaaa-0000-4000-8000-0000000000a3', bridge_id: 'B9', display_name: 'Ravi', email: null, user_id: 'ravi', identity_type: 'actor', status: 'pending', parent_entity_id: SHOP, pin_hash: null };
  let flags = { signin_providers: ['google', 'microsoft'], signin_required: 'none' };
  identityAuth.rowsOfCandidates = async (q, ids) => [PERSON, STAFF, NOWAY].filter((p) => ids.includes(p.identity_id));
  identityAuth.verifyCredential = async (q, person, creds) => (creds && creds.pin === '4827' ? { ok: true } : { ok: false, status: 400 });
  eventsLib.record = (ev) => { written.push(ev); return Promise.resolve({ written: true }); };
  policy.get = async () => flags;
  provider._connectBuilt(true);
  const reset = () => { flags = { signin_providers: ['google', 'microsoft'], signin_required: 'none' }; resetWorld(); written.length = 0; world.people = { p: PERSON, s: STAFF, n: NOWAY }; };
  const call = (method, path, who, body, headers) =>
    new Promise((resolve, reject) => {
      const data = body === undefined ? '' : JSON.stringify(body);
      const req = http.request(apiBase + path, { method, headers: Object.assign({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), 'x-device-id': DEVICE }, who ? { 'x-test-as': who } : {}, headers || {}) }, (res) => {
        let text = '';
        res.on('data', (d) => (text += d));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text, json: (() => { try { return JSON.parse(text); } catch (e) { return null; } })() }));
      });
      req.on('error', reject);
      req.end(data);
    });
  const startLink = (who, body) => call('POST', '/api/signin/provider/link/start', who, body);
  const ltOf = (res) => new URL(res.json.url).searchParams.get('lt');
  const mine = (id) => world.links.filter((l) => l.identity_id === id);
  const ends = (res, tail) => String(res.headers.location || '').endsWith(tail);
  /** the whole connect round trip for a person: re-proof → lt → provider → callback */
  async function connect(who, tamper, opts) {
    const start = await startLink(who, { provider: 'google', pin: '4827' });
    assert.strictEqual(start.status, 200, start.body);
    const trip = await roundTrip(Object.assign({ tamper: tamper || claimsOf({ sub: 'g-link-1' }), lt: ltOf(start) }, opts || {}));
    return { start, trip };
  }

  await checkAsync('G1 re-proof is required: no PIN or a wrong PIN is one blind 401 and writes no lt; no session at all is a 401', async () => {
    reset();
    let res = await startLink('p', { provider: 'google' });
    assert.deepStrictEqual([res.status, res.json.code], [401, 'REAUTH_FAILED']);
    res = await startLink('p', { provider: 'google', pin: '0000' });
    assert.deepStrictEqual([res.status, res.json.code], [401, 'REAUTH_FAILED']);
    assert.strictEqual([...world.pending.values()].filter((row) => row.kind === 'linkstart').length, 0, 'no lt without proof');
    res = await startLink(null, { provider: 'google', pin: '4827' });
    assert.strictEqual(res.status, 401);
    assert.ok(written.length === 2 && written.every((ev) => ev.action === 'fail'), 'the refused proofs are audited');
    reset();
  });
  await checkAsync("G2 connect: the link is written for the lt's own account from the TOKEN's subject, the result is a word in the address (no session), audit has the keyed hash only; then Google signs that person in", async () => {
    reset();
    const { start, trip } = await connect('p');
    assert.ok(ends(trip.callback, '#c=linked'), trip.callback.headers.location);
    assert.ok(!/#h=|token/.test(trip.callback.headers.location));
    assert.strictEqual(mine(SHOP).length, 1);
    assert.deepStrictEqual([mine(SHOP)[0].subject, mine(SHOP)[0].issuer, mine(SHOP)[0].entity_id], ['g-link-1', issuer, SHOP]);
    const events = written.filter((ev) => ev.action === 'link');
    assert.strictEqual(events.length, 1);
    assert.ok(/^[0-9a-f]{64}$/.test(events[0].subject_hash) && !JSON.stringify(written).includes('g-link-1'), 'a keyed hash, never the subject');
    assert.ok(!JSON.stringify(logLines).includes(ltOf(start)), 'no lt in a log');
    const again = await roundTrip({ tamper: claimsOf({ sub: 'g-link-1' }) });
    assert.ok(new URLSearchParams(fragment(again.callback)).get('h'), 'a hand-off code for the linked subject');
    reset();
  });
  await checkAsync('G3 the lt is bound to its device and is single use: another device, a replay or a made-up lt is a finished sign-in and links nothing', async () => {
    reset();
    const start = await startLink('p', { provider: 'google', pin: '4827' });
    const visit = (lt, device) => rawGet(apiBase + '/api/signin/provider/google/start?' + new URLSearchParams({ device_id: device, lt }).toString());
    const other = await visit(ltOf(start), 'device-someone-else');
    assert.ok(ends(other, '#e=SSO_HANDOFF'), 'other device: ' + other.status + ' ' + other.headers.location);
    const replay = await visit(ltOf(start), DEVICE);
    assert.ok(ends(replay, '#e=SSO_HANDOFF'), 'the other device spent it: ' + replay.headers.location);
    const forged = await visit(crypto.randomBytes(32).toString('base64url'), DEVICE);
    assert.ok(ends(forged, '#e=SSO_HANDOFF'), 'a made-up lt');
    assert.strictEqual(world.links.length, 0, 'links: ' + JSON.stringify(world.links));
    reset();
  });
  await checkAsync("G4 subject binding: whatever e-mail the provider says, the link goes to the lt's account only", async () => {
    reset();
    const { trip } = await connect('p', claimsOf({ sub: 'g-link-4', email: 'asha@shop.test' })); // the provider says the colleague's e-mail; the lt is the owner's
    assert.ok(ends(trip.callback, '#c=linked'));
    assert.deepStrictEqual(world.links.map((l) => l.identity_id), [SHOP]);
    reset();
  });
  await checkAsync('G5 the shop switched Google off: link start is 403 SIGNIN_PROVIDER_NOT_ACCEPTED; switched off mid-trip, the callback writes nothing and says so', async () => {
    reset();
    flags = { signin_providers: ['microsoft'], signin_required: 'none' };
    const res = await startLink('p', { provider: 'google', pin: '4827' });
    assert.deepStrictEqual([res.status, res.json.code], [403, 'SIGNIN_PROVIDER_NOT_ACCEPTED']);
    flags = { signin_providers: ['google'], signin_required: 'none' };
    const start = await startLink('p', { provider: 'google', pin: '4827' });
    flags = { signin_providers: [], signin_required: 'none' };
    const trip = await roundTrip({ tamper: claimsOf({ sub: 'g-link-5' }), lt: ltOf(start) });
    assert.ok(ends(trip.callback, '#c=SIGNIN_PROVIDER_NOT_ACCEPTED'), trip.callback.headers.location);
    assert.strictEqual(world.links.length, 0);
    reset();
  });
  await checkAsync('G6 the same Google twice for one shop is LINK_EXISTS (one per account, one subject per shop); the same subject on ANOTHER shop is allowed and never said', async () => {
    reset();
    assert.ok(ends((await connect('p')).trip.callback, '#c=linked'));
    const twice = await connect('p');
    assert.ok(ends(twice.trip.callback, '#c=LINK_EXISTS'), twice.trip.callback.headers.location);
    const colleague = await connect('s');
    assert.ok(ends(colleague.trip.callback, '#c=LINK_EXISTS'));
    assert.strictEqual(world.links.length, 1);
    reset();
    world.links.push({ link_id: 'dddddddd-0000-4000-8000-000000000001', entity_id: 'eeeeeeee-0000-4000-8000-000000000001', identity_id: 'eeeeeeee-0000-4000-8000-000000000001', provider: 'google', issuer, tenant: '', subject: 'g-link-1' });
    assert.ok(ends((await connect('p')).trip.callback, '#c=linked'), 'another shop holding the subject changes nothing');
    reset();
  });
  await checkAsync("G7 the list shows the person's own links only and never a subject or issuer; providers say live and accepted", async () => {
    reset();
    await connect('p');
    world.links.push({ link_id: 'dddddddd-0000-4000-8000-000000000002', entity_id: SHOP, identity_id: STAFF.identity_id, provider: 'google', issuer, tenant: '', subject: 'g-staff', email: 'x@y.z', email_verified: true });
    const res = await call('GET', '/api/signin/provider/links', 'p');
    assert.strictEqual(res.status, 200, res.body);
    assert.strictEqual(res.json.links.length, 1, "the colleague's link is not mine");
    assert.ok(!/g-link-1|g-staff|issuer|subject/.test(res.body), 'no subject or issuer in the list');
    assert.ok(res.json.providers.every((p) => p.live === true && p.accepted === true));
    assert.strictEqual((await call('GET', '/api/signin/provider/links', null)).status, 401);
    reset();
  });
  await checkAsync('G8 unlink: re-proof first (401), a foreign or made-up id is the same 404, own link is deleted and audited', async () => {
    reset();
    await connect('p');
    const id = mine(SHOP)[0].link_id;
    let res = await call('DELETE', '/api/signin/provider/links/' + id, 'p', { pin: '9999' });
    assert.deepStrictEqual([res.status, res.json.code], [401, 'REAUTH_FAILED']);
    assert.strictEqual(mine(SHOP).length, 1, 'a failed proof deletes nothing');
    world.links.push({ link_id: 'dddddddd-0000-4000-8000-000000000003', entity_id: SHOP, identity_id: STAFF.identity_id, provider: 'google', issuer, tenant: '', subject: 'g-staff' });
    res = await call('DELETE', '/api/signin/provider/links/dddddddd-0000-4000-8000-000000000003', 'p', { pin: '4827' });
    assert.deepStrictEqual([res.status, res.json.code], [404, 'LINK_NOT_FOUND'], "a colleague's link");
    res = await call('DELETE', '/api/signin/provider/links/not-an-id', 'p', { pin: '4827' });
    assert.deepStrictEqual([res.status, res.json.code], [404, 'LINK_NOT_FOUND']);
    res = await call('DELETE', '/api/signin/provider/links/' + id, 'p', { pin: '4827' });
    assert.strictEqual(res.status, 200, res.body);
    assert.strictEqual(mine(SHOP).length, 0);
    const gone = written.filter((ev) => ev.action === 'unlink');
    assert.strictEqual(gone.length, 1);
    assert.ok(/^[0-9a-f]{64}$/.test(gone[0].subject_hash));
    reset();
  });
  await checkAsync('G9 the last way in is kept (409 LAST_WAY_IN, the link stays); a business that requires the provider keeps its staff on it (403 LINK_ENFORCED)', async () => {
    reset();
    world.links.push({ link_id: 'dddddddd-0000-4000-8000-000000000004', entity_id: SHOP, identity_id: NOWAY.identity_id, provider: 'google', issuer, tenant: '', subject: 'g-noway' });
    let res = await call('DELETE', '/api/signin/provider/links/dddddddd-0000-4000-8000-000000000004', 'n', { pin: '4827' });
    assert.deepStrictEqual([res.status, res.json.code], [409, 'LAST_WAY_IN']);
    assert.strictEqual(mine(NOWAY.identity_id).length, 1);
    flags = { signin_providers: ['google'], signin_required: 'google' };
    world.links.push({ link_id: 'dddddddd-0000-4000-8000-000000000005', entity_id: SHOP, identity_id: STAFF.identity_id, provider: 'google', issuer, tenant: '', subject: 'g-staff' });
    res = await call('DELETE', '/api/signin/provider/links/dddddddd-0000-4000-8000-000000000005', 's', { pin: '4827' });
    assert.deepStrictEqual([res.status, res.json.code], [403, 'LINK_ENFORCED']);
    assert.strictEqual(mine(STAFF.identity_id).length, 1);
    reset();
  });
  await checkAsync('G10 an unlink inside the 60 seconds kills a code already issued (L1, through the real connect and unlink)', async () => {
    reset();
    await connect('p');
    const trip = await roundTrip({ tamper: claimsOf({ sub: 'g-link-1' }) });
    const code = new URLSearchParams(fragment(trip.callback)).get('h');
    const del = await call('DELETE', '/api/signin/provider/links/' + mine(SHOP)[0].link_id, 'p', { pin: '4827' });
    assert.strictEqual(del.status, 200);
    const swap = await call('POST', '/api/signin/provider/handoff', null, { code });
    assert.deepStrictEqual([swap.status, swap.json.code], [403, 'SSO_NOT_LINKED']);
    reset();
  });
  await checkAsync('G11 the buttons stay grey (link start 404) while the connect step is switched off', async () => {
    reset();
    provider._connectBuilt(false);
    const res = await startLink('p', { provider: 'google', pin: '4827' });
    assert.deepStrictEqual([res.status, res.json.code], [404, 'PROVIDER_OFF']);
    provider._connectBuilt(true);
    reset();
  });
  await checkAsync('G12 no subject or PIN in any log line or audit row of this section', async () => {
    const everything = logLines.join('\n') + JSON.stringify(written);
    assert.ok(!/g-link-\d|g-staff|g-noway/.test(everything), 'no subject');
    assert.ok(!/"pin"|4827/.test(everything), 'no PIN');
  });

  identityAuth.rowsOfCandidates = real.rowsOfCandidates;
  identityAuth.verifyCredential = real.verifyCredential;
  eventsLib.record = real.record;
  policy.get = real.get;
};

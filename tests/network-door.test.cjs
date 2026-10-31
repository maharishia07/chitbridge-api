/**
 * tests/network-door.test.cjs — THE PASS AT CTP'S DOOR (PLT-45 / RAIL-96 / RAIL-97, 25 Oct 2026).
 *
 * The real router, the REAL envelope and query signing and the real certificate check (lib/netcert, lib/netmember); only the database, the key directory and the
 * deliverer are stubbed. Every case is a refusal or an acceptance with its STATUS, CODE and WORDS, and whether anything was written.
 * What it pins: a standalone installation behaves as before; a member or master accepts a chit only from a peer with a valid certificate signed by the PINNED key
 * (the master itself excepted); a lapsed, revoked, wrongly-signed, wrongly-bound or missing certificate is refused in words; the master's questions are verified with the
 * pinned key and only the master may ask them; a lapsed member can still renew; only a master answers certificate / directory / locate.
 * On main (before this change) every network case fails: there is no pass, no pinned key and no network ask.
 */
'use strict';
const crypto = require('crypto');
const path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;

const pair = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { priv: privateKey, pem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
};
const signerOf = (kp) => ({ alg: 'ed25519', sign: (hash) => crypto.sign(null, Buffer.from(hash, 'utf8'), kp.priv).toString('base64') });

const MASTER = pair(); /* the network root key */
const ROGUE = pair(); /* someone else's network key */
const MASTER_CTP = pair(); /* the master's own CTP identity (not the network key) */
const SENDER = pair(); /* the member that sends us a chit */
const OTHER_SENDER_KEY = pair();

const TO = '11111111-1111-4111-8111-111111111111';
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();

function rows(s, p, ctx) {
  if (/to_jsonb\(i\) ->> 'network_role'/.test(s)) return [{ network_role: ctx.role || 'standalone' }];
  if (/FROM installation WHERE installation_key = \$1/.test(s)) return ctx.peer ? [ctx.peer] : [];
  /* RAIL-107: the sender is looked up by bridge id (stubFor); a window-shopping sender has no row here yet and one is made */
  if (/f_installation_of/.test(s) && /FROM identities WHERE bridge_id/.test(s)) return ctx.sender ? [ctx.sender] : [];
  if (/^INSERT INTO identities/.test(s)) return [{ identity_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', display_name: 'MX Pumps' }];
  if (/f_place_entity/.test(s)) return [];
  if (/FROM identities WHERE bridge_id = \$1/.test(s)) return ctx.to ? [ctx.to] : [];
  if (/f_ctp_may_deliver/.test(s)) return [{ ok: true }];
  if (/information_schema\.tables/.test(s)) return [{}];
  if (/FROM network_revoked/.test(s)) return (ctx.revoked || []).map((serial) => ({ serial }));
  if (/FROM membership_certificate WHERE installation_key = \$1 ORDER BY issued_at/.test(s)) return ctx.certRows || [];
  if (/FROM installation i\s+WHERE NOT i\.hosted_locally/.test(s)) return ctx.peers || [];
  if (/FROM registry_change WHERE seq/.test(s)) return ctx.changes || [];
  if (/count\(DISTINCT bridge_id\)/.test(s)) return [{ entities: (ctx.changes || []).length, last_seq: String((ctx.changes || []).length) }];
  if (/FROM registry_entry e JOIN installation/.test(s)) return ctx.hints || [];
  return [];
}
const h = G.harness({ rows, known: { [TO]: 'TO' } });
const directory = require(path.join(API, 'lib', 'ctpdirectory'));
const mint = require(path.join(API, 'lib', 'mint'));
mint.deliver = async (sender, chit_id, copies) => { h.note('mint.deliver', { sender, chit_id, entity: copies[0].entity_id }); return { ok: true }; };
require(path.join(API, 'lib', 'govresolve')).resolveInstallationGovernance = async () => null;
const keys = require(path.join(API, 'lib', 'ctpkeys'));
const net = require(path.join(API, 'lib', 'netmember'));
const netcert = require(path.join(API, 'lib', 'netcert'));
const envelope = require(path.join(API, 'lib', 'ctpenvelope'));
const ctpquery = require(path.join(API, 'lib', 'ctpquery'));
const app = h.app('/api/ctp', require(path.join(API, 'routes', 'ctp')));

const DOMAIN = 'mx.example.com';
const PEER = { installation_key: 'mx-1', domain: DOMAIN, hosted_locally: false, active: true };
const MASTER_PEER = { installation_key: 'master-1', domain: 'master.example.com', hosted_locally: false, active: true };

/** a certificate for mx-1, signed by `by` (default the master), with overrides on the body */
function certFor(patch, by, signKey) {
  const body = Object.assign({
    v: 1, serial: 'M-test', installation_key: 'mx-1', domain: DOMAIN, public_key_hash: netcert.fingerprint(SENDER.pem), accepts_populations: ['live'],
    not_before: iso(NOW - 60000), not_after: iso(NOW + 3600000), issued_by: 'master-1'
  }, patch || {});
  process.env.CB_NETWORK_ROOT_KEY = (signKey || by || MASTER).privPem;
  keys._reset();
  const sealed = netcert.seal(body);
  delete process.env.CB_NETWORK_ROOT_KEY;
  keys._reset();
  return { cert: body, sealed };
}

/** what the sender's manifest says, per scenario */
let manifestNow = null;
let manifestFresh = null;
directory.publicKeyFor = async (domain, ik, o) => {
  const m = o && o.fresh && manifestFresh ? manifestFresh : manifestNow;
  return m ? { ok: true, public_key: m.public_key, manifest: m } : { ok: false, why: 'no manifest at ' + domain };
};
directory.manifestFor = async (domain, o) => ({ ok: true, manifest: o && o.fresh && manifestFresh ? manifestFresh : manifestNow });

function env(from) {
  const e = envelope.sign(envelope.build({ installation_key: 'mx-1', population: 'live', bridge_id: 'CBSEND0001' }, { bridge_id: 'CBRECV0001' }, { chit_id: 'chit-1', copy: { sender_entity_id: 'sender-1', business_json: {} } }), signerOf(from || SENDER));
  return e;
}
const query = (ik, ask, kp, toKey) => ctpquery.sign(ctpquery.build({ installation_key: ik, population: 'live' }, Object.assign({ domain: 'me.example.com' }, toKey ? { installation_key: toKey } : {}), ask), signerOf(kp));

/* scenario setup: who WE are (the receiver) */
function receiver(role, extra) {
  process.env.INSTALLATION_KEY = 'me-1';
  for (const k of ['CB_MASTER_DOMAIN', 'CB_MASTER_INSTALLATION', 'CB_MASTER_KEY', 'CB_NETWORK_ROOT_KEY']) delete process.env[k];
  if (role === 'member') {
    process.env.CB_MASTER_DOMAIN = 'master.example.com';
    process.env.CB_MASTER_INSTALLATION = 'master-1';
    process.env.CB_MASTER_KEY = extra && 'pin' in extra ? extra.pin : MASTER.pem;
  }
  if (role === 'master') process.env.CB_NETWORK_ROOT_KEY = MASTER.privPem;
  keys._reset();
  net._reset();
}

const LIVE_TO = { identity_id: TO, population: 'live' };
const withCert = (cert) => ({ ctp: '1', installation_key: 'mx-1', public_key: SENDER.pem, membership: cert });
const bare = () => ({ ctp: '1', installation_key: 'mx-1', public_key: SENDER.pem });
const WORDS = {
  none: 'mx-1 holds no membership certificate from the network master (master-1), so it is not accepted here. Its operator asks the master for one.'
};

/* [name, role, door, body, ctx, manifest, status, code, why (string | RegExp), wrote?] */
const CASES = [];
const add = (...c) => CASES.push(c);
const D = (name, role, manifest, ctx, status, code, why, wrote, fresh, extra) => CASES.push([name, role, 'deliver', null, Object.assign({ peer: PEER, to: LIVE_TO }, ctx || {}), manifest, status, code, why, !!wrote, fresh, extra]);

D('deliver · standalone: no certificate asked for (as before)', 'standalone', bare(), {}, 200, undefined, undefined, true);
D('deliver · member: a sender with no certificate is refused in words', 'member', bare(), {}, 403, 'CTP_NO_MEMBERSHIP', WORDS.none);
D('deliver · member: a valid certificate signed by the pinned master is accepted', 'member', withCert(certFor()), {}, 200, undefined, undefined, true);
D('deliver · member: a certificate signed by another key is refused', 'member', withCert(certFor({}, ROGUE)), {}, 403, 'CTP_MEMBERSHIP_UNTRUSTED', /not signed by the master this installation pinned/);
D('deliver · member: a wrong master key pinned refuses a genuine certificate', 'member', withCert(certFor()), {}, 403, 'CTP_MEMBERSHIP_UNTRUSTED', /not signed by the master this installation pinned/, false, null, { pin: ROGUE.pem });
D('deliver · member: a lapsed certificate is refused with the date', 'member', withCert(certFor({ not_after: iso(NOW - 1000) })), {}, 403, 'CTP_MEMBERSHIP_LAPSED', /lapsed on .*renews it with the network master/);
D('deliver · member: a lapsed certificate still says "lapsed" when the fresh read shows none (a lapse beats a silence)', 'member', withCert(certFor({ not_after: iso(NOW - 1000) })), {}, 403, 'CTP_MEMBERSHIP_LAPSED', /lapsed on/, false, bare());
D('deliver · member: a certificate that has not started is refused', 'member', withCert(certFor({ not_before: iso(NOW + 3600000), not_after: iso(NOW + 7200000) })), {}, 403, 'CTP_MEMBERSHIP_NOT_YET', /starts at/);
D('deliver · member: a clock 4 minutes behind the start is tolerated (one skew constant, 5 min)', 'member', withCert(certFor({ not_before: iso(NOW + 4 * 60000), not_after: iso(NOW + 3600000) })), {}, 200, undefined, undefined, true);
D('deliver · member: a certificate issued to another installation is refused', 'member', withCert(certFor({ installation_key: 'mx-2' })), {}, 403, 'CTP_MEMBERSHIP_MISMATCH', /issued to mx-2, not to mx-1/);
D('deliver · member: a certificate for another domain is refused', 'member', withCert(certFor({ domain: 'evil.example.com' })), {}, 403, 'CTP_MEMBERSHIP_MISMATCH', /names the domain evil.example.com/);
D('deliver · member: a certificate for another signing key (a copy) is refused', 'member', withCert(certFor({ public_key_hash: netcert.fingerprint(OTHER_SENDER_KEY.pem) })), {}, 403, 'CTP_MEMBERSHIP_MISMATCH', /different signing key/);
D('deliver · member: a tampered certificate is refused', 'member', withCert(Object.assign(certFor(), { cert: Object.assign({}, certFor().cert, { not_after: iso(NOW + 999999999) }) })), {}, 403, 'CTP_MEMBERSHIP_UNTRUSTED', /contents do not match its seal/);
D('deliver · member: a suspended sender (serial on the revoked list) is refused, its data untouched', 'member', withCert(certFor()), { revoked: ['M-test'] }, 403, 'CTP_MEMBERSHIP_REVOKED', /was suspended by the network master .*Its own shops and data are untouched/);
D('deliver · member: the pinned master itself needs no certificate', 'member', { ctp: '1', installation_key: 'master-1', public_key: MASTER_CTP.pem }, { peer: MASTER_PEER }, 200, undefined, undefined, true, null, { fromKey: MASTER_CTP, from: 'master-1' });
D('deliver · member: a renewed certificate is seen at once (one fresh read)', 'member', withCert(certFor({ not_after: iso(NOW - 1000) })), {}, 200, undefined, undefined, true, withCert(certFor({ serial: 'M-new' })));
D('deliver · member with no master pinned refuses everyone, in words', 'member', withCert(certFor()), {}, 403, 'CTP_NO_MASTER_PINNED', /no master pinned/, false, null, { pin: '' });
D('deliver · master: judges its members by its own network key', 'master', withCert(certFor()), {}, 200, undefined, undefined, true);
D('deliver · master: a member with no certificate is refused', 'master', bare(), {}, 403, 'CTP_NO_MEMBERSHIP', /holds no membership certificate from the network master \(me-1\)/);

const Q = (name, role, ik, ask, kp, ctx, manifest, status, code, why, check) => CASES.push([name, role, 'query', { ik, ask, kp }, Object.assign({ peer: Object.assign({}, PEER, { installation_key: ik }) }, ctx || {}), manifest, status, code, why, false, null, { check }]);

const MASTER_ASKER = { peer: MASTER_PEER };
/* SIT run 4: a domain changed hands; the master's pull for the retired member reached its successor, which answered */
CASES.push(['query · a network question for ANOTHER installation (a domain that changed hands) is refused in words', 'member', 'query', { ik: 'master-1', ask: { want: 'registry_changes', after: 0 }, kp: MASTER, to: 'old-1' }, Object.assign({ peer: Object.assign({}, PEER, { installation_key: 'master-1' }) }, MASTER_ASKER), null, 409, 'CTP_NOT_THIS_INSTALLATION', /this is me-1, not old-1/, false, null, {}]);
CASES.push(['query · the same question addressed to this installation is answered', 'member', 'query', { ik: 'master-1', ask: { want: 'registry_changes', after: 0 }, kp: MASTER, to: 'me-1' }, Object.assign({ peer: Object.assign({}, PEER, { installation_key: 'master-1' }) }, MASTER_ASKER, { changes: [] }), null, 200, undefined, undefined, false, null, {}]);
Q('query · the master pulls registry changes (verified with the PINNED key)', 'member', 'master-1', { want: 'registry_changes', after: 0 }, MASTER, { peer: MASTER_PEER, changes: [{ seq: 1, bridge_id: 'CBROOT0001', entity_type: 'general', population: 'live', status: 'active', change: 'created' }] }, null, 200, undefined, undefined,
  (b) => b.ok === true && b.changes.length === 1 && b.changes[0].bridge_id === 'CBROOT0001' && b.entities === 1 && Object.keys(b.changes[0]).sort().join() === 'bridge_id,change,entity_type,population,seq,status');
Q('query · registry changes signed with the master\'s CTP key (not the pinned one) are refused', 'member', 'master-1', { want: 'registry_changes', after: 0 }, MASTER_CTP, MASTER_ASKER, null, 403, 'CTP_QUERY_REFUSED', 'signature did not verify');
Q('query · registry changes asked by a peer that is not the master', 'member', 'mx-1', { want: 'registry_changes', after: 0 }, SENDER, {}, withCert(certFor()), 403, 'CTP_NOT_MASTER', 'only this installation’s network master may ask that');
Q('query · registry changes on a standalone installation', 'standalone', 'master-1', { want: 'registry_changes', after: 0 }, MASTER, MASTER_ASKER, null, 403, 'CTP_NOT_MASTER', 'only this installation’s network master may ask that');
Q('query · a member does not answer the master\'s questions (certificate)', 'member', 'mx-1', { want: 'certificate' }, SENDER, {}, withCert(certFor()), 403, 'CTP_NOT_A_MASTER', 'this installation is not a network master, so it does not answer that');
Q('query · a standalone installation does not answer locate', 'standalone', 'mx-1', { want: 'locate', bridge_id: 'CBROOT0001' }, SENDER, {}, bare(), 403, 'CTP_NOT_A_MASTER', 'this installation is not a network master, so it does not answer that');
Q('query · master: a LAPSED member can still ask for its certificate (that is how it comes back)', 'master', 'mx-1', { want: 'certificate' }, SENDER, {
  certRows: [{ cert: certFor().cert, signature: certFor().sealed.sig, status: 'active', not_after: iso(NOW + 3600000) }] }, bare(), 200, undefined, undefined,
  (b) => b.ok === true && b.found === true && b.membership.cert.serial === 'M-test' && !!b.membership.sealed.sig);
Q('query · master: a suspended member is told so, in words', 'master', 'mx-1', { want: 'certificate' }, SENDER, {
  certRows: [{ cert: certFor().cert, signature: 'x', status: 'suspended', not_after: iso(NOW + 3600000) }] }, bare(), 200, undefined, undefined,
  (b) => b.found === false && b.why === 'the certificate of mx-1 is suspended');
Q('query · master: the directory is sealed by the network key and lists the other certified members only, sealed', 'master', 'mx-1', { want: 'directory' }, SENDER, {
  revoked: ['M-old'], peers: [{ installation_key: 'au-1', domain: 'au.example.com', ctp_endpoint: 'https://au.example.com/api/ctp/deliver', country: 'AU', label: 'au-1' }] }, bare(), 200, undefined, undefined,
  (b) => b.found === true && b.directory.for === 'mx-1' && b.directory.revoked[0] === 'M-old' && b.directory.peers[0].installation_key === 'au-1' &&
    !!b.sealed.sig && b.sealed.alg === 'ed25519'); /* the seal itself is verified in network-sync.test.cjs (the harness blanks timestamps, which the seal covers) */
Q('query · master: locate needs a certificate', 'master', 'mx-1', { want: 'locate', bridge_id: 'CBROOT0001' }, SENDER, {}, bare(), 403, 'CTP_NO_MEMBERSHIP', /holds no membership certificate/);
Q('query · master: locate answers a LIST of hints (installation and domain, nothing else)', 'master', 'mx-1', { want: 'locate', bridge_id: 'CBROOT0001' }, SENDER, {
  hints: [{ installation_key: 'au-1', domain: 'au.example.com' }, { installation_key: 'ae-1', domain: 'ae.example.com' }] }, withCert(certFor()), 200, undefined, undefined,
  (b) => b.found === true && b.hints.length === 2 && Object.keys(b.hints[0]).sort().join() === 'domain,installation_key');
Q('query · master: locate for an id nobody holds says so', 'master', 'mx-1', { want: 'locate', bridge_id: 'CBNONE0000' }, SENDER, {}, withCert(certFor()), 200, undefined, undefined,
  (b) => b.found === false && /holds no business with that id/.test(b.why));
Q('query · member: resolve needs a certificate too', 'member', 'mx-1', { want: 'resolve', handle: 'CBROOT0001' }, SENDER, {}, bare(), 403, 'CTP_NO_MEMBERSHIP', WORDS.none);

(async () => {
  console.log('\n══ NETWORK · the pass at the door ══\n');
  let pass = 0, fail = 0;
  for (const c of CASES) {
    const [name, role, door, qspec, ctx, manifest, status, code, why, wrote, fresh, extra] = c;
    receiver(role, extra);
    manifestNow = manifest; manifestFresh = fresh || null;
    let body;
    if (door === 'deliver') body = env(extra && extra.fromKey ? extra.fromKey : SENDER);
    else body = query(qspec.ik, qspec.ask, qspec.kp, qspec.to);
    if (door === 'deliver' && extra && extra.from) body = envelope.sign(Object.assign({}, envelope.build({ installation_key: extra.from, population: 'live', bridge_id: 'CBSEND0001' }, { bridge_id: 'CBRECV0001' }, { chit_id: 'chit-1', copy: { sender_entity_id: 'sender-1', business_json: {} } })), signerOf(extra.fromKey));
    const r = await h.run(app, { url: '/api/ctp/' + door, body, identity: {}, ctx: Object.assign({ role }, ctx) });
    const b = r.body || {};
    const delivered = r.calls.some((x) => x.via === 'mint.deliver');
    const whyOk = why === undefined ? true : why instanceof RegExp ? why.test(String(b.why)) : b.why === why;
    const codeOk = code === undefined ? true : JSON.stringify(b).includes(code);
    const checkOk = extra && extra.check ? !!extra.check(b) : true;
    const statusOk = r.status === status;
    if (statusOk && whyOk && codeOk && checkOk && !!wrote === delivered) { pass++; console.log('   ok   ' + name + '  (' + status + ')'); }
    else { fail++; console.log('   FAIL ' + name + '\n          got ' + r.status + ' ' + JSON.stringify(b).slice(0, 400) + ' wrote=' + delivered); }
  }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  console.log('  ' + pass + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

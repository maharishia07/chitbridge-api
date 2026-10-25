/**
 * tests/ctp-return-door.test.cjs — RAIL-106: THE DOOR TAKES AN EVENT. The real router, the REAL envelope and signature check; only the database, the key directory and the applier are stubbed.
 * What it pins: an event goes through the SAME checks as a delivery (unknown peer 403, forged 409, tampered 409, crossing refused 409, no recipient here 404) and only then reaches
 * the applier; a verified one is answered `accepted: true` with `applied`; the applier's refusals come back with their status, code and words; a refused event writes nothing;
 * a delivery still goes to mint.deliver, untouched.
 */
'use strict';
const crypto = require('crypto');
const path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;

const pair = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { priv: privateKey, pem: publicKey.export({ type: 'spki', format: 'pem' }).toString() };
};
const signerOf = (kp) => ({ alg: 'ed25519', sign: (hash) => crypto.sign(null, Buffer.from(hash, 'utf8'), kp.priv).toString('base64') });
const SENDER = pair();
const FORGER = pair();
const TO = '11111111-1111-4111-8111-111111111111';
const CHIT = 'c0000000-0000-4000-8000-0000000000c1';

function rows(s, p, ctx) {
  if (/to_jsonb\(i\) ->> 'network_role'/.test(s)) return [{ network_role: 'standalone' }];
  if (/FROM installation WHERE installation_key = \$1/.test(s)) return ctx.peer ? [ctx.peer] : [];
  /* RAIL-107: the sender is looked up by bridge id (stubFor); a window-shopping sender has no row here yet and one is made */
  if (/f_installation_of/.test(s) && /FROM identities WHERE bridge_id/.test(s)) return ctx.sender ? [ctx.sender] : [];
  if (/^INSERT INTO identities/.test(s)) return [{ identity_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', display_name: 'MX Pumps' }];
  if (/f_place_entity/.test(s)) return [];
  if (/FROM identities WHERE bridge_id = \$1/.test(s)) return ctx.to ? [ctx.to] : [];
  if (/f_ctp_may_deliver/.test(s)) return [{ ok: ctx.population !== 'refuse' }];
  if (/information_schema\.tables/.test(s)) return [{}];
  return [];
}
const h = G.harness({ rows, known: { [TO]: 'TO' } });
const directory = require(path.join(API, 'lib', 'ctpdirectory'));
const mint = require(path.join(API, 'lib', 'mint'));
mint.deliver = async (sender, chit_id) => {
  h.note('mint.deliver', { chit_id });
  return { ok: true };
};
require(path.join(API, 'lib', 'govresolve')).resolveInstallationGovernance = async () => null;
const returnPath = require(path.join(API, 'lib', 'ctpreturn'));
let APPLY = { ok: true, applied: true, why: 'applied' };
returnPath.apply = async (o) => {
  h.note('apply', { chit_id: o.chit_id, kind: o.event.kind, from: o.from.bridge_id, ik: o.from.installation_key, to: o.to.identity_id });
  return APPLY;
};
const keys = require(path.join(API, 'lib', 'ctpkeys'));
const envelope = require(path.join(API, 'lib', 'ctpenvelope'));
const app = h.app('/api/ctp', require(path.join(API, 'routes', 'ctp')));
process.env.INSTALLATION_KEY = 'me-1';
keys._reset();

const PEER = { installation_key: 'mx-1', domain: 'mx.example.com', hosted_locally: false, active: true };
directory.publicKeyFor = async () => ({ ok: true, public_key: SENDER.pem, manifest: { ctp: '1', installation_key: 'mx-1', public_key: SENDER.pem } });
const FROM = { installation_key: 'mx-1', population: 'live', bridge_id: 'CBSEND0001', display_name: 'MX Pumps' };
const event = (kp, patch) =>
  envelope.sign(
    envelope.buildEvent(FROM, { bridge_id: 'CBRECV0001' }, { chit_id: CHIT, event: Object.assign({ kind: 'status', seq: 1, status: 'accepted', copy: 'received' }, patch || {}) }),
    signerOf(kp || SENDER)
  );
const delivery = () => envelope.sign(envelope.build(FROM, { bridge_id: 'CBRECV0001' }, { chit_id: CHIT, copy: { sender_entity_id: 's1', business_json: {} } }), signerOf(SENDER));
const LIVE_TO = { identity_id: TO, population: 'live' };

/* [name, body, ctx, apply answer, status, expected] */
const CASES = [
  ['an event from a known peer is applied to our rows and answered accepted', () => event(), { peer: PEER, to: LIVE_TO }, null, 200, { applied: true, accepted: true }],
  [
    'the applier is told the chit, the kind, the sender party and installation, and OUR recipient (resolved here, never the envelope’s)',
    () => event(),
    { peer: PEER, to: LIVE_TO },
    null,
    200,
    { check: (r) => r.calls.some((c) => c.via === 'apply' && c.payload.chit_id === 'UUID#1' && c.payload.kind === 'status' && c.payload.from === 'CBSEND0001' && c.payload.ik === 'mx-1' && c.payload.to === 'TO') }
  ],
  ['an older or repeated event is answered accepted with applied false (the sender stops resending)', () => event(), { peer: PEER, to: LIVE_TO }, { ok: true, applied: false, why: 'older or repeated — ignored' }, 200, { applied: false, accepted: true }],
  [
    'the applier’s refusal comes back with its status, its words and its code',
    () => event(),
    { peer: PEER, to: LIVE_TO },
    { ok: false, status: 404, code: 'CTP_EVENT_NO_CHIT', why: 'this business holds no copy of that chit' },
    404,
    { code: 'CTP_EVENT_NO_CHIT', why: 'this business holds no copy of that chit', accepted: false }
  ],
  ['an event from an installation we do not deal with is refused 403 and never applied', () => event(), { peer: null, to: LIVE_TO }, null, 403, { code: 'CTP_PEER_REFUSED', none: true }],
  ['an event signed with the wrong key is refused 409 and never applied', () => event(FORGER), { peer: PEER, to: LIVE_TO }, null, 409, { code: 'CTP_ENVELOPE_REFUSED', why: /signature did not verify/, none: true }],
  [
    'an event whose contents changed after sealing is refused 409 and never applied',
    () => {
      const e = JSON.parse(JSON.stringify(event()));
      e.event.status = 'completed';
      return e;
    },
    { peer: PEER, to: LIVE_TO },
    null,
    409,
    { code: 'CTP_ENVELOPE_REFUSED', why: /seal does not match/, none: true }
  ],
  ['an event for a business that is not here is refused 404 and never applied', () => event(), { peer: PEER, to: null }, null, 404, { code: 'CTP_RECIPIENT_NOT_HERE', none: true }],
  ['an event across a crossing this business refuses is refused 409 and never applied', () => event(), { peer: PEER, to: LIVE_TO, population: 'refuse' }, null, 409, { code: 'CTP_CROSSING_REFUSED', none: true }],
  ['a delivery is still written by mint.deliver, as before', () => delivery(), { peer: PEER, to: LIVE_TO }, null, 200, { delivered: true, accepted: true }]
];

(async () => {
  console.log('\n== CTP return path · the door ==\n');
  let pass = 0,
    fail = 0;
  for (const [name, mk, ctx, apply, status, want] of CASES) {
    APPLY = apply || { ok: true, applied: true, why: 'applied' };
    const r = await h.run(app, { url: '/api/ctp/deliver', body: mk(), identity: {}, ctx });
    const b = r.body || {};
    const applied = r.calls.some((c) => c.via === 'apply');
    const delivered = r.calls.some((c) => c.via === 'mint.deliver');
    const ok =
      r.status === status &&
      (want.applied === undefined || b.applied === want.applied) &&
      (want.accepted === undefined || b.accepted === want.accepted) &&
      (want.code === undefined || JSON.stringify(b).includes(want.code)) &&
      (want.why === undefined || (want.why instanceof RegExp ? want.why.test(String(b.why)) : b.why === want.why)) &&
      (!want.none || (!applied && !delivered)) &&
      (want.delivered === undefined || delivered === want.delivered) &&
      (want.check === undefined || want.check(r));
    if (ok) {
      pass++;
      console.log('   ok   ' + name + '  (' + r.status + ')');
    } else {
      fail++;
      console.log('   FAIL ' + name + '\n          got ' + r.status + ' ' + JSON.stringify(b).slice(0, 300) + ' applied=' + applied + ' delivered=' + delivered);
    }
  }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

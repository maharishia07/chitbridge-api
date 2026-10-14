/**
 * tests/ctp-door.test.cjs — EVERY REFUSAL AT CTP'S RECEIVING DOOR, ONE TEST EACH (round T2-SPLIT, 2026-10-14).
 *
 * POST /api/ctp/deliver and POST /api/ctp/query are unauthenticated on purpose — the signature, checked against the key
 * on the sender's OWN domain, stands in for a session — so the order and the wording of the refusals ARE the security.
 * Both doors asked "do we deal with this installation?" with the same query and the same three refusals, written out
 * twice; T2-SPLIT lifted that into ONE peer lookup (lib/ctpdirectory peerByKey). This file pins every answer each door
 * gives — status, `why`, and that nothing was written — so the lift (and any later edit) cannot move one.
 *
 * The real router; db, the key directory, the envelope opener and the deliverer stubbed. No DB, no network.
 */
'use strict';
const path = require('path');
const G = require('./support/route-golden.cjs');
const API = G.API;

const TO = '11111111-1111-4111-8111-111111111111';
function rows(s, p, ctx) {
  if (/FROM installation WHERE installation_key = \$1/.test(s)) { if (ctx.peerThrows) throw new Error('no table'); return ctx.peer ? [ctx.peer] : []; }
  if (/FROM identities WHERE bridge_id = \$1/.test(s)) return ctx.to ? [ctx.to] : [];
  if (/f_ctp_may_deliver/.test(s)) { if (ctx.crossThrows) throw new Error('fn missing'); return [{ ok: !!ctx.mayCross }]; }
  return [];
}
const h = G.harness({ rows, known: { [TO]: 'TO' } });
const directory = require(path.join(API, 'lib', 'ctpdirectory'));
directory.publicKeyFor = async (domain, ik) => (h.state.ctx.noKey ? { ok: false, why: 'no manifest at ' + domain } : { ok: true, public_key: 'PK-' + ik });
const envelope = require(path.join(API, 'lib', 'ctpenvelope'));
envelope.open = (env, o) => (h.state.ctx.openWhy ? { ok: false, why: h.state.ctx.openWhy }
  : { ok: true, chit_id: 'chit-1', copy: Object.assign({ entity_id: 'THEIRS', business_json: {} }, h.state.ctx.noSender ? {} : { sender_entity_id: 'sender-1' }), header: {} });
const ctpquery = require(path.join(API, 'lib', 'ctpquery'));
ctpquery.open = (q) => (h.state.ctx.openWhy ? { ok: false, why: h.state.ctx.openWhy } : { ok: true, ask: (q && q.ask) || {} });
const mint = require(path.join(API, 'lib', 'mint'));
mint.deliver = async (sender, chit_id, copies) => { h.note('mint.deliver', { sender, chit_id, entity: copies[0].entity_id }); if (h.state.ctx.storeThrows) { const e = new Error('disk'); e.code = '53100'; throw e; } return { ok: true }; };
require(path.join(API, 'lib', 'govresolve')).resolveInstallationGovernance = async () => null;

const app = h.app('/api/ctp', require(path.join(API, 'routes', 'ctp')));

const PEER = { installation_key: 'mx-1', domain: 'mx.example.com', hosted_locally: false, active: true };
const ENV = { ctp: '1', from: { installation_key: 'mx-1', bridge_id: 'CBSEND0001' }, to: { bridge_id: 'CBRECV0001' } };
const LIVE_TO = { identity_id: TO, population: 'live' };
const ok = { peer: PEER, to: LIVE_TO, mayCross: true };
const env = (patch) => Object.assign({}, ENV, patch || {});

/* [name, door, body, ctx, status, why (exact, or a RegExp), wrote?] */
const CASES = [
  ['deliver · not a CTP/1 envelope', 'deliver', { ctp: '2' }, ok, 400, 'not a CTP/1 envelope'],
  ['deliver · no recipient named', 'deliver', env({ to: {} }), ok, 400, 'the envelope does not name a recipient'],
  ['deliver · no installation named', 'deliver', env({ from: {} }), ok, 400, 'the envelope does not say which installation sent it'],
  ['deliver · a stranger installation', 'deliver', env(), { to: LIVE_TO }, 403, 'installation mx-1 is not one we deal with'],
  ['deliver · an installation we stopped dealing with', 'deliver', env(), { peer: Object.assign({}, PEER, { active: false }) }, 403, 'installation mx-1 is not one we deal with'],
  ['deliver · the installation table unreadable → a stranger', 'deliver', env(), { peerThrows: true }, 403, 'installation mx-1 is not one we deal with'],
  ['deliver · a local installation over the wire', 'deliver', env(), { peer: Object.assign({}, PEER, { hosted_locally: true }) }, 409, 'installation mx-1 is hosted here — a local copy must not arrive over the wire'],
  ['deliver · no domain recorded', 'deliver', env(), { peer: Object.assign({}, PEER, { domain: null }) }, 403, 'no domain recorded for mx-1, so its key cannot be found'],
  ['deliver · the sender\'s manifest unreadable', 'deliver', env(), Object.assign({}, ok, { noKey: true }), 403, 'could not read the sender’s manifest: no manifest at mx.example.com'],
  ['deliver · no such business here', 'deliver', env(), { peer: PEER }, 404, 'no active business here with bridge id CBRECV0001'],
  ['deliver · the crossing rule unreadable → refuse', 'deliver', env(), Object.assign({}, ok, { crossThrows: true }), 503, 'this installation cannot check whether that crossing is permitted — refusing'],
  ['deliver · live, but not paired', 'deliver', env(), Object.assign({}, ok, { mayCross: false }), 409, 'refused'],
  ['deliver · a local world that does not name the peer', 'deliver', env(), Object.assign({}, ok, { to: { identity_id: TO, population: 'test' }, mayCross: false }), 409, '“test” is a local name on both sides — it must name mx-1 as a peer first'],
  ['deliver · the envelope does not open', 'deliver', env(), Object.assign({}, ok, { openWhy: 'signature does not verify' }), 409, 'signature does not verify'],
  ['deliver · the copy names no sender', 'deliver', env(), Object.assign({}, ok, { noSender: true }), 400, 'the copy does not say who sent it'],
  ['deliver · our store fails → 500, said', 'deliver', env(), Object.assign({}, ok, { storeThrows: true }), 500, 'this installation failed to store it', true],
  ['deliver · accepted, written as OUR recipient', 'deliver', env(), ok, 200, undefined, true],
  ['query · not a CTP/1 query', 'query', { ctp: '1', kind: 'deliver' }, ok, 400, 'not a CTP/1 query'],
  ['query · no installation named', 'query', { ctp: '1', kind: 'query', from: {} }, ok, 400, 'the question does not say which installation is asking'],
  ['query · a stranger installation', 'query', { ctp: '1', kind: 'query', from: { installation_key: 'mx-1' } }, {}, 403, 'installation mx-1 is not one we deal with'],
  ['query · a local installation', 'query', { ctp: '1', kind: 'query', from: { installation_key: 'mx-1' } }, { peer: Object.assign({}, PEER, { hosted_locally: true }) }, 409, 'installation mx-1 is hosted here — ask locally'],
  ['query · no domain recorded', 'query', { ctp: '1', kind: 'query', from: { installation_key: 'mx-1' } }, { peer: Object.assign({}, PEER, { domain: '' }) }, 403, 'no domain recorded for mx-1, so its key cannot be found'],
  ['query · the asker\'s manifest unreadable', 'query', { ctp: '1', kind: 'query', from: { installation_key: 'mx-1' } }, { peer: PEER, noKey: true }, 403, 'could not read the asker’s manifest: no manifest at mx.example.com'],
  ['query · the question does not open', 'query', { ctp: '1', kind: 'query', from: { installation_key: 'mx-1' } }, { peer: PEER, openWhy: 'unsigned' }, 403, 'unsigned'],
];

(async () => {
  console.log('\n══ CTP · every refusal at the receiving door ══\n');
  let pass = 0, fail = 0;
  for (const [name, door, body, ctx, status, why, wrote] of CASES) {
    const r = await h.run(app, { url: '/api/ctp/' + door, body, identity: {}, ctx: Object.assign({}, ctx) });
    const b = r.body || {};
    const delivered = r.calls.some((c) => c.via === 'mint.deliver');
    const whyOk = why === undefined ? true : b.why === why;
    const refusedFlag = door === 'deliver' ? (status === 200 ? b.accepted === true : b.accepted === false) : (b.ok === false);
    const wroteOk = !!wrote === delivered;
    const extra = status === 200 ? (b.to === 'CBRECV0001' && r.calls.find((c) => c.via === 'mint.deliver').payload.entity === 'TO') : true;
    if (r.status === status && whyOk && refusedFlag && wroteOk && extra) { pass++; console.log('   ok   ' + name + '  (' + status + ')'); }
    else { fail++; console.log('   FAIL ' + name + '\n          got ' + r.status + ' ' + JSON.stringify(b) + ' wrote=' + delivered); }
  }
  console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
  console.log('  ' + pass + ' checks');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

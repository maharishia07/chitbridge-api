/**
 * tests/ctp-tolerant-reader.test.cjs — RAIL-126 (b): the CTP inbound side is a TOLERANT READER (Postel; Fowler).
 *
 * OWNS      the version rule of lib/ctpenvelope (speaks · versionRefusal) and that the envelope opener and the query opener read a higher minor of our major
 *           and ignore a field they do not know, and that another major is refused with a clear problem. The doors' answers are tests/ctp-door.test.cjs.
 * CALLED BY scripts/guards.cjs (the offline gate).
 * FLOW      lib/ctpenvelope · lib/ctpquery, real, no db, no network
 * CARD      05-ctp-and-cross-installation/seal-rail
 * MIN unit-per-rule
 * MIN refusal-path
 * Run: node tests/ctp-tolerant-reader.test.cjs
 */
'use strict';
const path = require('path');
const API = path.join(__dirname, '..');
const envelope = require(path.join(API, 'lib', 'ctpenvelope'));
const ctpquery = require(path.join(API, 'lib', 'ctpquery'));
let pass = 0, fail = 0;
const ok = (name, cond, why) => { if (cond) { pass++; console.log('   ok   ' + name); } else { fail++; console.log('   FAIL ' + name + (why ? '\n          ' + JSON.stringify(why) : '')); } };

ok('speaks: our major, with or without a minor', ['1', '1.0', '1.7', '1.2.3'].every(envelope.speaks));
ok('speaks: another major, or no version at all, is not read', ['2', '2.1', '0', '1x', '', 1, null, undefined, {}].every((v) => !envelope.speaks(v)));
ok('versionRefusal: ours answers nothing', envelope.versionRefusal('1') === null && envelope.versionRefusal('1.9') === null);
ok('versionRefusal: not a version at all is left to the old "not an envelope" answer', envelope.versionRefusal(2) === null && envelope.versionRefusal('abc') === null);
const refusal = envelope.versionRefusal('3.4');
ok('versionRefusal: another major is a 400 CTP_VERSION_UNSUPPORTED that names both majors', refusal.status === 400 && refusal.code === 'CTP_VERSION_UNSUPPORTED' && /CTP\/1/.test(refusal.why) && /CTP\/3/.test(refusal.why), refusal);

const FROM = { installation_key: 'platform-0', population: 'live', bridge_id: 'CBAAAAAAAA', display_name: 'A Shop' };
const TO = { bridge_id: 'CBBBBBBBBB' };
const CHIT = { chit_id: 'd07f5862-0fc2-45bb-9fc7-e7f9999b1943', header: { summary_json: {} }, copy: { entity_id: 'e1', business_json: {} } };
const ctx = { population: 'live', verify: () => true };
const built = envelope.build(FROM, TO, CHIT);
ok('what we send says exactly "1" (strict on output)', built.ctp === '1', built.ctp);
ok('open: our own envelope opens', envelope.open(envelope.sign(built, null), ctx).ok === true);
/* a peer on a higher minor seals what it sends, so its version is under its own seal */
const higher = envelope.sign(Object.assign({}, envelope.build(FROM, TO, CHIT), { ctp: '1.4' }), null);
ok('open: a higher minor of our major is read', envelope.open(higher, ctx).ok === true, envelope.open(higher, ctx));
const extra = Object.assign({}, envelope.sign(envelope.build(FROM, TO, CHIT), null), { future_field: { a: 1 }, hint: 'x' });
ok('open: a field this version does not know is ignored, not refused, and does not break the seal', envelope.open(extra, ctx).ok === true, envelope.open(extra, ctx));
const other = envelope.sign(Object.assign({}, envelope.build(FROM, TO, CHIT), { ctp: '2' }), null);
ok('open: another major is refused', envelope.open(other, ctx).ok === false && /not a CTP.1 envelope/.test(envelope.open(other, ctx).why));

const q = { ctp: '1.2', kind: 'query', from: { installation_key: 'a' }, ask: { want: 'resolve' }, nonce: 'n', at: new Date().toISOString(), future_field: 1 };
const asked = ctpquery.open(q, { verify: () => true });
ok('query open: a higher minor and a field we do not know are not refused for either', !/not a CTP\/1 query/.test(String(asked.why)), asked);
ok('query open: another major is refused', /not a CTP\/1 query/.test(String(ctpquery.open(Object.assign({}, q, { ctp: '2' }), { verify: () => true }).why)));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

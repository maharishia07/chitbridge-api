'use strict';
// @type: unit
/**
 * supply-use-idem.test.cjs: api #1178 accepts an Idempotency-Key on POST /api/supplies/:id/issue, so the web `supplyUse` door sends ONE key per attempt
 * (EP row idem:'attempt', the FIN-63 helper in core.js; no new helper).
 * CARD 16-finance/payments · owns: the proof, through the real api() door, that supplyUse repeats its key · called by: ci.yml
 * The real core.js and the real EP row run against a fake fetch. Fails on main (the row has no idem, so every send carries no key).
 *   1. two sends of the same issue (a retry after a lost answer) carry the same Idempotency-Key
 *   2. after a 2xx the next issue gets a NEW key (a second issue is a second issue, not a replay)
 *   3. a different quantity is a different attempt
 * Run: node e2e/supply-use-idem.test.cjs
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..', 'public');
const html = fs.readFileSync(path.join(root, 'app.html'), 'utf8');
const at = html.indexOf('const EP = {');
const ep = vm.runInNewContext('(' + html.slice(html.indexOf('{', at), html.indexOf('\n};', at) + 2) + ')');
assert(ep.supplyUse, 'supplyUse row missing from EP');

const sent = [];
let n = 0;
let answer = null; /* null = the answer is lost on the way (the fetch rejects) */
const noop = () => {};
/* a DOM stand-in that swallows every call: the busy overlay is not under test */
const dom = () => new Proxy(function () {}, { get: (_, k) => (k === 'style' || k === 'classList' || k === 'dataset' ? dom() : k === Symbol.toPrimitive ? () => '' : dom()), apply: () => dom(), set: () => true });
const box = {
  console, JSON, Date, Promise, Set, Map, Object, Array, Number, String, Error, URLSearchParams, Uint8Array, setTimeout, clearTimeout, Math, performance: { now: Date.now },
  EP: ep, CFG: { API_BASE: 'http://api.test' }, SESSION: { token: 't' }, cblog: noop,
  CB: { _uuid: () => 'k' + ++n }, document: dom(), localStorage: { getItem: () => null, setItem: noop },
  fetch: async (url, init) => { sent.push({ url, key: init.headers['Idempotency-Key'] }); if (!answer) throw new TypeError('Failed to fetch');
    return answer(); }
};
box.window = box;
box.window.CBOffline = null; box.addEventListener = noop; box.navigator = { onLine: true };
vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(root, 'app', 'core.js'), 'utf8'), box, { filename: 'core.js' });

(async () => {
  const issue = (qty) => vm.runInContext('api', box)('supplyUse', { params: { id: 's1' }, body: { qty } }).catch((e) => { if (process.env.DBG) console.log(e.message); return null; });
  await issue(2);
  await issue(2);
  assert(sent[0].url.endsWith('/api/supplies/s1/issue'), 'wrong door: ' + sent[0].url);
  assert(sent[0].key && sent[0].key === sent[1].key, 'a retried issue must send the SAME Idempotency-Key, got ' + JSON.stringify(sent));
  console.log('  ok  a retry carries the same key');
  await issue(3);
  assert(sent[2].key && sent[2].key !== sent[0].key, 'a different quantity is a different attempt');
  console.log('  ok  a different quantity gets its own key');
  answer = () => ({ status: 200, ok: true, json: async () => ({}), clone() { return this; } });
  await issue(2);
  assert.strictEqual(sent[3].key, sent[0].key, 'the retry that finally lands still carries the attempt key');
  await issue(2);
  assert(sent[4].key && sent[4].key !== sent[3].key, 'after a 2xx the next issue must get a NEW key');
  console.log('  ok  after a 2xx the next issue gets a new key');
})().catch((e) => { console.error('  XX  ' + e.message); process.exit(1); });
